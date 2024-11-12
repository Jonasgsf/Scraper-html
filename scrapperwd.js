const fs = require('fs');
const cheerio = require('cheerio');
const path = require('path');
const puppeteer = require('puppeteer');

/**
 * Função auxiliar para normalizar textos.
 * Remove espaços extras e converte para minúsculas.
 *
 * @param {string} text - Texto a ser normalizado.
 * @returns {string} Texto normalizado.
 */
function normalizeText(text) {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Função para identificar o template com base no conteúdo do HTML.
 *
 * @param {string} html - Conteúdo HTML do arquivo.
 * @returns {string|null} Identificador do template ou null se não reconhecido.
 */
function identifyTemplate(html) {
  const $ = cheerio.load(html);

  // Converter todo o texto para minúsculas e remover espaços extras
  const textContent = $('body').text().toLowerCase().replace(/\s+/g, ' ');

  // Template7: Verifica se existe 'case ref' e 'case name'
  if (/case\s*ref/i.test(textContent) && /case\s*name/i.test(textContent)) {
    return 'template7';
  }

  // Template5: Verifica se existem cabeçalhos como 'Start Time', 'Duration', 'Case Details', 'Hearing Type' e 'Hearing Channel'
  if (
    /start\s*time/i.test(textContent) &&
    /duration/i.test(textContent) &&
    /case\s*details/i.test(textContent) &&
    /hearing\s*type/i.test(textContent) &&
    /hearing\s*channel/i.test(textContent)
  ) {
    return 'template5';
  }

  // Template4a: Verifica se existe uma célula de cabeçalho com 'Claim Number Claimant'
  const isCourtServePage = normalizeText($('title').text()).includes('courtserve');

  const hasTimeHeader = $('table')
    .find('th, td')
    .filter(function () {
      return normalizeText($(this).text()) === 'time';
    }).length > 0;

  const hasClaimNumberClaimantHeader = $('table')
    .find('th, td')
    .filter(function () {
      return normalizeText($(this).text()).includes('claim number') && $(this).text().toLowerCase().includes('claimant');
    }).length > 0;

  const hasDefendantHeader = $('table')
    .find('th, td')
    .filter(function () {
      return normalizeText($(this).text()).includes('defendant');
    }).length > 0;

  const hasGenericKeywords = $('body').text().match(/(hearing room|deputy district judge|sitting at|court room|magistrates court)/i);

  if (/claim\s*number/i.test(textContent) && 
    /Nottingham/i.test(textContent) && 
    /Wigham/i.test(textContent) && 
    /Court\s*Room\s*7/i.test(textContent)) {
    return 'template4';
  } else if (isCourtServePage && hasTimeHeader && hasClaimNumberClaimantHeader && hasDefendantHeader && hasGenericKeywords || (/claim\s*number/i.test(textContent))) {
    return 'template4a';
  }

  return null;
}

/**
 * Função para extrair dados da tabela para o template4.
 *
 * @param {object} $ - Instância do cheerio.
 * @param {object} table - Elemento da tabela.
 * @param {string} courtName - Nome do tribunal.
 * @param {string} courtDate - Data do tribunal.
 * @returns {Array} Array de objetos com os dados extraídos.
 */
function extractDataTemplate4($, table, courtName, courtDate) {
  let titlename = '';
  // pegar o título com base no template
  titlename = $('title').text().trim(); // Seleciona o título para o template
  const data = [];
  const rows = table.find('tr');

  let headersIndex = {};

  rows.each((i, row) => {
    const cells = $(row).find('th, td');
    const cellsText = [];

    cells.each((j, cell) => {
      let cellText = $(cell).text().trim();
      cellText = cellText.replace(/\s+/g, ' ');
      cellsText.push(cellText);
    });

    // Identificar os índices dos cabeçalhos
    if (
      cellsText.some((text) => /claim\s*number/i.test(normalizeText(text)))
    ) {
      // Mapear os índices dos cabeçalhos considerando o colspan
      let logicalIndex = 0;

      cells.each((j, cell) => {
        let headerText = normalizeText($(cell).text());
        let colspan = parseInt($(cell).attr('colspan')) || 1;

        if (/claim\s*number/i.test(headerText)) {
          headersIndex.claimNumber = logicalIndex;
        } else if (/^(claimant|applicant|petitioner)$/i.test(headerText)) {
          headersIndex.claimant = logicalIndex;
        } else if (/^(defendant|respondent)$/i.test(headerText)) {
          headersIndex.defendant = logicalIndex;
        }

        logicalIndex += colspan;
      });

      console.log('Cabeçalhos encontrados (template4):', headersIndex);
    } else if (cellsText.length > 1 && Object.keys(headersIndex).length > 0) {
      // Verificar se a linha é uma linha de dados válida
      if (cellsText.every((text) => text === '')) return;

      // Extrair dados das linhas de dados
      const claimNumber = cellsText[headersIndex.claimNumber] || '';
      let claimant = cellsText[headersIndex.claimant] || '';
      let defendant = cellsText[headersIndex.defendant] || '';
      claimant = claimant.replace(/\|/g, '');
      defendant = defendant.replace(/\|/g, '');

      // Logs para depuração
      console.log(`Linha ${i}:`, {
        claimNumber,
        claimant,
        defendant,
      });

      function extractCourtLocation(titlename) {
        const match = titlename.match(/CourtServe:\s*(.*?)\s*County Court/i);
        return match ? match[1].trim() : null;
      }

      courtName = extractCourtLocation(titlename);

      function formatCourtDate(courtDatestr) {
        // Extrai a parte da data da string
        const datePart = courtDatestr.split(', ')[1]; // '18th October 2024'

        // Remove o sufixo 'th', 'st', 'nd', ou 'rd' da data
        const cleanDatePart = datePart.replace(/(\d+)(st|nd|rd|th)/, '$1'); // '18 October 2024'

        // Cria um objeto Date
        const date = new Date(cleanDatePart);

        // Formata a data como dd/mm/yyyy
        const day = String(date.getDate()).padStart(2, '0'); // Adiciona zero à esquerda
        const month = String(date.getMonth() + 1).padStart(2, '0'); // Mês começa em 0
        const year = date.getFullYear();

        return `${day}/${month}/${year}`;
      }

      const rowData = {
        'Court Name': courtName || '',
        'Court Date': formatCourtDate(courtDate) || '',
        'Claim Number': claimNumber || '',
        'Claimant': claimant || '',
        'Defendant': defendant || '',
        'Duration': 'Not Provided',
        'Hearing Type': 'Not Provided',
        'Hearing Channel': 'Not Provided',
        'Title': titlename,
      };

      data.push(rowData);
    }
  });

  return data;
}

/**
 * Função para extrair dados da tabela para o template4a.
 *
 * @param {object} $ - Instância do cheerio.
 * @param {object} table - Elemento da tabela.
 * @param {string} courtName - Nome do tribunal.
 * @param {string} courtDate - Data do tribunal.
 * @returns {Array} Array de objetos com os dados extraídos.
 */
function extractDataTemplate4a($, table, courtName, courtDate) {
    let titlename = $('title').text().trim();
    const data = [];
    const rows = table.find('tr');
  
    let headersIndex = {};
    let currentCase = null; // Para armazenar o caso atual
    let lastTime = ''; // Para armazenar o último Time encontrado
  
    function normalizeText(text) {
      return text.replace(/\s+/g, ' ').trim().toLowerCase();
    }
  
    function extractCourtLocation(titlename) {
      const match = titlename.match(/CourtServe:\s*(.*?)\s*,/i);
      if (match) {
        return match[1].trim();
      } else {
        // Tentar outra correspondência
        const matchAlt = titlename.match(/In The County Court at\s*(.*)/i);
        if (matchAlt) {
          return matchAlt[1].trim();
        }
      }
      return '';
    }
  
    function formatCourtDate(courtDatestr) {
      if (!courtDatestr) {
        // Tentar extrair a data do título ou do conteúdo
        const dateMatch = titlename.match(/\b(\d{1,2}\/\d{1,2}\/\d{2,4})\b/);
        if (dateMatch) {
          courtDatestr = dateMatch[1];
        } else {
          const dateMatchAlt = titlename.match(/\b([A-Za-z]+,?\s*\d{1,2}\s+[A-Za-z]+\s+\d{4})\b/);
          if (dateMatchAlt) {
            courtDatestr = dateMatchAlt[1];
          }
        }
      }
  
      // Agora, converter courtDatestr para o formato "dd/mm/aaaa"
      let date;
      if (/\d{1,2}\/\d{1,2}\/\d{2,4}/.test(courtDatestr)) {
        // Se já estiver no formato dd/mm/aaaa, converter diretamente
        const parts = courtDatestr.split('/');
        const day = parts[0].padStart(2, '0');
        const month = parts[1].padStart(2, '0');
        let year = parts[2];
        if (year.length === 2) {
          year = '20' + year;
        }
        date = new Date(`${year}-${month}-${day}`);
      } else if (/[A-Za-z]+,?\s*\d{1,2}\s+[A-Za-z]+\s+\d{4}/.test(courtDatestr)) {
        // Formato textual, por exemplo, "Tuesday, 12 November 2024"
        date = new Date(courtDatestr);
      } else {
        // Tentativa de criar a data diretamente
        date = new Date(courtDatestr);
      }
  
      if (isNaN(date)) {
        return '';
      }
  
      const day = String(date.getDate()).padStart(2, '0');
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const year = date.getFullYear();
  
      return `${day}/${month}/${year}`;
    }
  
    // Obter courtName e courtDate do título se estiverem vazios
    if (!courtName) {
      courtName = extractCourtLocation(titlename);
    }
    if (!courtDate) {
      courtDate = formatCourtDate(courtDate);
    }
  
    // Iterar pelas linhas da tabela
    rows.each((i, row) => {
      let cells = $(row).find('th, td');
      let cellsText = [];
      let logicalIndexes = []; // Para mapear o índice lógico de cada célula
  
      let logicalIndex = 0;
  
      cells.each((j, cell) => {
        let cellText = $(cell).text().trim().replace(/\s+/g, ' ');
        cellsText.push(cellText);
  
        let colspan = parseInt($(cell).attr('colspan')) || 1;
        logicalIndexes.push({ index: logicalIndex, colspan: colspan });
  
        logicalIndex += colspan;
      });
  
      // Verificar se estamos no novo formato
      const isNewFormat = cellsText.some((text) => /^claim\s+\w+:/i.test(text));
  
      if (isNewFormat) {
        // Lógica para o novo formato
        cellsText.forEach((cellText) => {
          // Extrair o Time se presente
          const timeMatch = cellText.match(/^(\d{1,2}\.\d{2})$/);
          if (timeMatch) {
            lastTime = timeMatch[1];
          }
  
          // Extrair Claim Number, Claimant e Defendant
          const claimMatch = cellText.match(/^Claim\s+(\w+):\s*(.*?)\s+versus\s+(.*)/i);
          if (claimMatch) {
            const claimNumber = claimMatch[1];
            const claimant = claimMatch[2];
            const defendant = claimMatch[3];
  
            // Salvar o caso atual se houver
            if (currentCase) {
              data.push({
                'Court Name': courtName || '',
                'Court Date': courtDate || '',
                'Claim Number': currentCase.claimNumber || '',
                'Claimant': currentCase.claimant.trim() || '',
                'Defendant': currentCase.defendant.trim() || '',
                'Duration': 'Not Provided',
                'Hearing Type': 'Not Provided',
                'Hearing Channel': 'Not Provided',
                'Title': titlename,
              });
            }
  
            // Iniciar um novo caso
            currentCase = {
              time: lastTime || '',
              claimNumber: claimNumber,
              claimant: claimant,
              defendant: defendant,
            };
          }
        });
      } else {
        // Lógica para o formato original
        // Identificar os índices dos cabeçalhos
        if (
          cellsText.some((text) => /^time$/i.test(normalizeText(text))) &&
          cellsText.some((text) => /claim\s*number/i.test(normalizeText(text))) &&
          cellsText.some((text) => /^claimant$/i.test(normalizeText(text))) &&
          cellsText.some((text) => /^(defendant|respondent)$/i.test(normalizeText(text)))
        ) {
          // Mapear os índices dos cabeçalhos
          logicalIndex = 0;
  
          cells.each((j, cell) => {
            let headerText = normalizeText($(cell).text());
            let colspan = parseInt($(cell).attr('colspan')) || 1;
  
            if (/^time$/i.test(headerText)) {
              headersIndex.time = logicalIndex;
            } else if (/^claim\s*number$/i.test(headerText)) {
              headersIndex.claimNumber = logicalIndex;
            } else if (/^claimant$/i.test(headerText)) {
              headersIndex.claimant = logicalIndex;
            } else if (/^(defendant|respondent)$/i.test(headerText)) {
              headersIndex.defendant = logicalIndex;
            }
  
            logicalIndex += colspan;
          });
  
          console.log('Cabeçalhos encontrados (template4a):', headersIndex);
        } else if (cellsText.length > 0 && Object.keys(headersIndex).length > 0) {
          // Linha de dados
          if (cellsText.every((text) => text === '')) return;
  
          // Mapear os dados considerando o colspan
          let rowData = {};
          let cellLogicalIndex = 0;
  
          cells.each((j, cell) => {
            let cellText = $(cell).text().trim().replace(/\s+/g, ' ');
            let colspan = parseInt($(cell).attr('colspan')) || 1;
  
            // Atribuir o texto da célula aos campos corretos
            for (let k = 0; k < colspan; k++) {
              let currentLogicalIndex = cellLogicalIndex + k;
  
              if (currentLogicalIndex === headersIndex.time) {
                rowData.time = cellText;
              } else if (currentLogicalIndex === headersIndex.claimNumber) {
                rowData.claimNumber = cellText;
              } else if (currentLogicalIndex === headersIndex.claimant) {
                if (!rowData.claimant) rowData.claimant = cellText;
                else rowData.claimant += ' ' + cellText;
              } else if (currentLogicalIndex === headersIndex.defendant) {
                if (!rowData.defendant) rowData.defendant = cellText;
                else rowData.defendant += ' ' + cellText;
              }
            }
  
            cellLogicalIndex += colspan;
          });
  
          // Se a linha tiver um novo Time, atualizar lastTime
          if (rowData.time) {
            lastTime = rowData.time;
          } else if (lastTime) {
            rowData.time = lastTime;
          }
  
          // Verificar se esta linha inicia um novo caso com base no Claim Number
          let isNewCase = rowData.claimNumber;
  
          if (isNewCase) {
            // Salvar o caso atual se houver
            if (currentCase) {
              data.push({
                'Court Name': courtName || '',
                'Court Date': courtDate || '',
                'Claim Number': currentCase.claimNumber || '',
                'Claimant': currentCase.claimant.trim() || '',
                'Defendant': currentCase.defendant.trim() || '',
                'Duration': 'Not Provided',
                'Hearing Type': 'Not Provided',
                'Hearing Channel': 'Not Provided',
                'Title': titlename,
              });
            }
  
            // Iniciar um novo caso
            currentCase = {
              time: rowData.time || '',
              claimNumber: rowData.claimNumber || '',
              claimant: rowData.claimant || '',
              defendant: rowData.defendant || '',
            };
          } else {
            // Continuação dos dados do caso atual
            if (currentCase) {
              if (rowData.claimant) {
                currentCase.claimant += ' ' + rowData.claimant;
              }
              if (rowData.defendant) {
                currentCase.defendant += ' ' + rowData.defendant;
              }
            }
          }
        }
      }
    });
  
    // Após o loop, verificar se há um caso atual a ser salvo
    if (currentCase) {
      data.push({
        'Court Name': courtName || '',
        'Court Date': courtDate || '',
        'Claim Number': currentCase.claimNumber || '',
        'Claimant': currentCase.claimant.trim() || '',
        'Defendant': currentCase.defendant.trim() || '',
        'Duration': 'Not Provided',
        'Hearing Type': 'Not Provided',
        'Hearing Channel': 'Not Provided',
        'Title': titlename,
      });
    }
  
    return data;
  }
  
  

/**
 * Função para extrair dados da tabela para o template5.
 *
 * @param {object} $ - Instância do cheerio.
 * @param {object} table - Elemento da tabela.
 * @param {string} courtName - Nome do tribunal.
 * @param {string} courtDate - Data do tribunal.
 * @returns {Array} Array de objetos com os dados extraídos.
 */
function extractDataTemplate5($, table, courtName, courtDate) {
  let titlename = '';
  // pegar o título com base no template
  titlename = $('title').text().trim(); // Seleciona o título para o template
  const data = [];
  const rows = table.find('tr');

  let headersIndex = {};

  rows.each((i, row) => {
    const cells = $(row).find('th, td');
    const dataCells = cells.filter(function () {
      return !$(this).hasClass('EmptyCellLayoutStyle');
    });

    const cellsText = [];

    dataCells.each((j, cell) => {
      let cellText = $(cell).text().trim();
      cellText = cellText.replace(/\s+/g, ' ');
      cellsText.push(cellText);
    });

    // Ignora linhas que contêm "Party Name" ou "Parties Suppressed"
    if (cellsText.some((text) => /party\s*name|parties\s*suppressed/i.test(text))) {
      return;
    }

    // Identificar os cabeçalhos como 'Start Time', 'Duration', 'Case Details', 'Hearing Type' e 'Hearing Channel'
    if (cellsText.some((text) => /^start\s*time$/i.test(normalizeText(text)))) {
      let logicalIndex = 0;

      dataCells.each((j, cell) => {
        let headerText = normalizeText($(cell).text());
        let colspan = parseInt($(cell).attr('colspan')) || 1;

        if (/^start\s*time$/i.test(headerText)) {
          headersIndex.startTime = logicalIndex;
        } else if (/^duration$/i.test(headerText)) {
          headersIndex.duration = logicalIndex;
        } else if (/^case\s*details$/i.test(headerText)) {
          headersIndex.caseDetails = logicalIndex;
        } else if (/^hearing\s*type$/i.test(headerText)) {
          headersIndex.hearingType = logicalIndex;
        } else if (/^hearing\s*channel$/i.test(headerText)) {
          headersIndex.hearingChannel = logicalIndex;
        }

        logicalIndex += colspan;
      });

      console.log('Cabeçalhos encontrados (template5):', headersIndex);
    } else if (cellsText.length > 1 && Object.keys(headersIndex).length > 0) {
      if (cellsText.every((text) => text === '')) return;

      // Captura apenas as linhas que contêm "Possession" no Case Details
      const hearingType = cellsText[5];
      if (!/possession/i.test(hearingType)) return;
      const startTime = cellsText[2];
      const duration = cellsText[3];
      let caseDetails = cellsText[4];
      const claimNumber = caseDetails.split(' ')[0];
      const hearingChannel = cellsText[6];

      // Verificando se claimNumber é válido
      if (claimNumber === 'PCOL') return;

      caseDetails = caseDetails.replace(/^[A-Z0-9]+ /, '');

      let claimant = '';
      let defendant = '';

      // Separar o texto do 'caseDetails' para identificar o 'Claimant' e 'Defendant'
      if (/\s+(v|vs)\s+/i.test(caseDetails) || /\s+(-v-|-vs-|versus)\s+/i.test(caseDetails)) {
        let parts = caseDetails.split(/\s+(v|vs|versus)\s+/i);
        if (/\s+(-v-|-vs-|versus)\s+/i.test(caseDetails)) {
          parts = caseDetails.split(/\s+(-v-|-vs-|versus)\s+/i);
        }
        if (parts.length >= 2) {
          claimant = parts[0].trim();
          defendant = parts[2].trim();
          claimant = claimant.replace(/\|/g, '');
          defendant = defendant.replace(/\|/g, '');
        } else {
          claimant = parts[0].trim();
          defendant = 'Not Provided';
          claimant = claimant.replace(/\|/g, '');
          defendant = defendant.replace(/\|/g, '');
        }
      } else {
        claimant = 'Not Provided';
        defendant = 'Not Provided';
      }

      console.log(`Linha ${i} dados extraídos:`, {
        startTime,
        duration,
        caseDetails,
        hearingType,
        hearingChannel,
        claimant,
        defendant,
      });
      function extractCourtLocation(titlename) {
        const match = titlename.match(/CourtServe:\s*(.*?)\s*County Court/i);
        return match ? match[1].trim() : null;
      }

      courtName = extractCourtLocation(titlename);

      function formatCourtDate(courtDatestr) {
        // Extrai a parte da data da string
        const datePart = courtDatestr.split(', ')[1]; // '18th October 2024'

        // Remove o sufixo 'th', 'st', 'nd', ou 'rd' da data
        const cleanDatePart = datePart.replace(/(\d+)(st|nd|rd|th)/, '$1'); // '18 October 2024'

        // Cria um objeto Date
        const date = new Date(cleanDatePart);

        // Formata a data como dd/mm/yyyy
        const day = String(date.getDate()).padStart(2, '0'); // Adiciona zero à esquerda
        const month = String(date.getMonth() + 1).padStart(2, '0'); // Mês começa em 0
        const year = date.getFullYear();

        return `${day}/${month}/${year}`;
      }

      const rowData = {
        'Court Name': courtName || '',
        'Court Date': formatCourtDate(courtDate) || '',
        'Claim Number': claimNumber || 'Not Provided',
        'Claimant': claimant || 'Not Provided',
        'Defendant': defendant || 'Not Provided',
        'Duration': duration || 'Not Provided',
        'Hearing Type': hearingType || 'Not Provided',
        'Hearing Channel': hearingChannel || 'Not Provided',
        'Title': titlename,
      };

      data.push(rowData);
    }
  });

  return data;
}

/**
 * Função para extrair dados da tabela para o template7.
 *
 * @param {object} $ - Instância do cheerio.
 * @param {object} table - Elemento da tabela.
 * @param {string} courtName - Nome do tribunal.
 * @param {string} courtDate - Data do tribunal.
 * @returns {Array} Array de objetos com os dados extraídos.
 */
function extractDataTemplate7($, table, courtName, courtDate) {
  let titlename = '';
  // pegar o título com base no template
  titlename = $('title').text().trim(); // Seleciona o título para o template
  const data = [];
  const rows = table.find('tr');

  let headersIndex = {};

  rows.each((i, row) => {
    const cells = $(row).find('th, td');
    const dataCells = cells.filter(function () {
      return !$(this).hasClass('EmptyCellLayoutStyle');
    });

    const cellsText = [];

    dataCells.each((j, cell) => {
      let cellText = $(cell).text().trim();
      cellText = cellText.replace(/\s+/g, ' ');
      cellsText.push(cellText);
    });

    console.log(`Linha ${i} cellsText:`, cellsText);

    if (cellsText.some((text) => /^case\s*ref$/i.test(normalizeText(text)))) {
      let logicalIndex = 0;

      dataCells.each((j, cell) => {
        let headerText = normalizeText($(cell).text());
        let colspan = parseInt($(cell).attr('colspan')) || 1;

        if (/^time$/i.test(headerText)) {
          headersIndex.time = logicalIndex;
        } else if (/^case\s*ref$/i.test(headerText)) {
          headersIndex.caseRef = logicalIndex;
        } else if (/^case\s*name$/i.test(headerText)) {
          headersIndex.caseName = logicalIndex;
        } else if (/^case\s*type$/i.test(headerText)) {
          headersIndex.caseType = logicalIndex;
        } else if (/^duration$/i.test(headerText)) {
          headersIndex.duration = logicalIndex;
        } else if (/^hearing\s*type$/i.test(headerText)) {
          headersIndex.hearingType = logicalIndex;
        } else if (/^hearing\s*platform$/i.test(headerText)) {
          headersIndex.hearingPlatform = logicalIndex;
        }

        logicalIndex += colspan;
      });

      console.log('Cabeçalhos encontrados (template7):', headersIndex);
    } else if (cellsText.length > 1 && Object.keys(headersIndex).length > 0) {
      if (cellsText.every((text) => text === '')) return;

      const time = cellsText[headersIndex.time] || '';
      const caseRef = cellsText[headersIndex.caseRef] || '';
      const caseName = cellsText[3];
      const caseType = cellsText[headersIndex.caseType] || '';
      const duration = cellsText[headersIndex.hearingType] || '';
      const hearingType = cellsText[5];
      const hearingPlatform = cellsText[6];

      if (!/posse|possession/i.test(caseType)) {
        return;
      }

      let claimant = '';
      let defendant = '';

      if (/\s*v(?:s)?\s*/i.test(caseName)) {
        const parts = caseName.split(/\s+(v|vs|versus)\s+/i);
        if (parts.length >= 2) {
          claimant = parts[0].trim();
          defendant = parts[2].trim();
          claimant = claimant.replace(/\|/g, '');
          defendant = defendant.replace(/\|/g, '');
        } else {
          claimant = parts[0].trim();
          defendant = 'Not Provided';
          claimant = claimant.replace(/\|/g, '');
        }
      } else {
        claimant = 'Not Provided';
        defendant = 'Not Provided';
      }

      console.log(`Linha ${i} dados extraídos:`, {
        time,
        caseRef,
        claimant,
        defendant,
        caseType,
        duration,
        hearingType,
        hearingPlatform,
      });
      function extractCourtLocation(titlename) {
        const match = titlename.match(/CourtServe:\s*(.*?)\s*County Court/i);
        return match ? match[1].trim() : null;
      }

      courtName = extractCourtLocation(titlename);

      function formatCourtDate(courtDatestr) {
        // Extrai a parte da data da string
        const datePart = courtDatestr.split(', ')[1]; // '18th October 2024'

        // Remove o sufixo 'th', 'st', 'nd', ou 'rd' da data
        const cleanDatePart = datePart.replace(/(\d+)(st|nd|rd|th)/, '$1'); // '18 October 2024'

        // Cria um objeto Date
        const date = new Date(cleanDatePart);

        // Formata a data como dd/mm/yyyy
        const day = String(date.getDate()).padStart(2, '0'); // Adiciona zero à esquerda
        const month = String(date.getMonth() + 1).padStart(2, '0'); // Mês começa em 0
        const year = date.getFullYear();

        return `${day}/${month}/${year}`;
      }

      const rowData = {
        'Court Name': courtName || '',
        'Court Date': formatCourtDate(courtDate) || '',
        'Claim Number': caseRef || '',
        'Claimant': claimant || 'Not Provided',
        'Defendant': defendant || 'Not Provided',
        'Duration': duration || 'Not Provided',
        'Hearing Type': hearingType || 'Not Provided',
        'Hearing Channel': hearingPlatform || 'Not Provided',
        'Title': titlename,
      };

      data.push(rowData);
    }
  });

  return data;
}

/**
 * Função para extrair dados da tabela para outros templates.
 * Atualmente retorna um array vazio, mas pode ser expandida conforme necessário.
 *
 * @param {object} $ - Instância do cheerio.
 * @param {object} table - Elemento da tabela.
 * @param {string} template - Identificador do template.
 * @param {string} courtName - Nome do tribunal.
 * @param {string} courtDate - Data do tribunal.
 * @returns {Array} Array de objetos com os dados extraídos.
 */
function extractDataTemplateOther($, table, template, courtName, courtDate) {
  let titlename = '';
  // pegar o título com base no template
  titlename = $('title').text().trim(); // Seleciona o título para o template
  // Implementar lógica específica para outros templates aqui, se necessário
  // Por enquanto, retornamos um array vazio
  return [];
}

/**
 * Função para extrair dados de um arquivo HTML.
 *
 * @param {string} filePath - Caminho para o arquivo HTML.
 * @returns {Array} Array de objetos com os dados extraídos.
 */
function scrapeDataFromHtml(filePath) {
  const html = fs.readFileSync(filePath, 'utf-8'); // Lê o arquivo HTML
  const $ = cheerio.load(html);
  const data = [];

  // Identificar o template com base no HTML
  const template = identifyTemplate(html);

  if (!template) {
    console.error('Template não reconhecido para o arquivo:', filePath);
    return data;
  }

  console.log(`Processando o arquivo ${filePath} com o ${template}`);

  // Variáveis para armazenar Court Name e Court Date

  let courtName = '';
  let courtDate = '';

  $('p').each((i, elem) => {
    const text = $(elem).text().trim();
    if (/court at/i.test(text) || /sitting at/i.test(text)) {
      const parts = text.split(/court at|sitting at/i);
      if (parts.length > 1) {
        courtName = parts[1].trim();
      }
    }

    const datePattern = /^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),\s+\d{1,2}(?:st|nd|rd|th)?\s+\w+\s+\d{4}$/i;
    if (datePattern.test(text)) {
      courtDate = text;
    }
  });

  // Limpar Court Name para evitar duplicações
  courtName = courtName
    .split(' ')
    .filter((item, pos, self) => self.indexOf(item) === pos)
    .join(' ');

  let tables = [];
  if (template === 'template4') {
    tables = $('table').filter(function () {
      const tableText = $(this).text().toLowerCase();
      return (
        /claim\s*number/i.test(tableText) &&
        /(claimant|applicant|petitioner)/i.test(tableText)
      );
    });
  } else if (template === 'template4a') {
    // Altere o seletor para que reconheça o cabeçalho agrupado
    tables = $('table').filter(function () {
      const tableText = normalizeText($(this).text());

      // Ajuste para detectar um número de processo com pelo menos quatro caracteres seguido de nomes
      const hasClaimPattern = /\b[a-z0-9]{4,}\b\s+[a-z]+\s+[a-z]+/i.test(tableText);
      return (
        /time\s+claim\s*number\s+claimant\s+defendant/i.test(tableText) ||
        hasClaimPattern
      );
    });
  } else if (template === 'template7') {
    tables = $('table').filter(function () {
      const tableText = $(this).text().toLowerCase();
      return (
        /case\s*ref/i.test(tableText) && /case\s*name/i.test(tableText)
      );
    });
  } else if (template === 'template5') {
    tables = $('table').filter(function () {
      const tableText = $(this).text().toLowerCase();
      return (
        /start\s*time/i.test(tableText) &&
        /duration/i.test(tableText) &&
        /case\s*details/i.test(tableText) &&
        /hearing\s*type/i.test(tableText) &&
        /hearing\s*channel/i.test(tableText)
      );
    });
  }

  if (tables.length === 0) {
    console.error('Nenhuma tabela encontrada no arquivo:', filePath);
    return data;
  }

  console.log(
    `Total de tabelas encontradas no arquivo ${filePath}: ${tables.length}`
  );

  const processedTables = new Set();
  const processedClaimNumbers = new Set();

  tables.each((tableIndex, tableElem) => {
    if (!processedTables.has(tableElem)) {
      processedTables.add(tableElem);
      console.log(`Processando tabela ${tableIndex + 1} de ${tables.length}`);
      const table = $(tableElem);

      let extractedData = [];

      if (template === 'template4') {
        extractedData = extractDataTemplate4($, table, courtName, courtDate);
      } else if (template === 'template4a') {
        extractedData = extractDataTemplate4a($, table, courtName, courtDate);
      } else if (template === 'template7') {
        extractedData = extractDataTemplate7($, table, courtName, courtDate);
      } else if (template === 'template5') {
        extractedData = extractDataTemplate5($, table, courtName, courtDate);
      } else {
        // Para outros templates, implementar conforme necessário
        extractedData = extractDataTemplateOther(
          $,
          table,
          template,
          courtName,
          courtDate
        );
      }

      extractedData.forEach((row) => {
        if (!processedClaimNumbers.has(row['Claim Number'])) {
          processedClaimNumbers.add(row['Claim Number']);
          data.push(row);
        }
      });
    }
  });

  return data;
}

/**
 * Função para salvar dados em um arquivo CSV.
 *
 * @param {Array} data - Array de objetos com os dados a serem salvos.
 * @param {string} outputPath - Caminho para o arquivo CSV de saída.
 */
function saveToCsv(data, outputPath) {
  try {
    const headers = [
      'Court Name',
      'Court Date',
      'Claim Number',
      'Claimant',
      'Defendant',
      'Duration',
      'Hearing Type',
      'Hearing Channel',
      'Title',
    ];

    if (data.length === 0) {
      console.warn('Nenhum dado para salvar no arquivo CSV.');
      return;
    }

    // Prepara o conteúdo CSV
    const csvContent = [headers.join(',')]
      .concat(
        data.map((row) => {
          const formattedRow = headers.map((header) => {
            const cellData = (row[header] || '').toString().trim();
            return `"${cellData.replace(/"/g, '""')}"`;
          });
          return formattedRow.join(',');
        })
      )
      .join('\n');

    fs.writeFileSync(outputPath, csvContent);
    console.log(`Dados salvos em ${outputPath}`);
  } catch (error) {
    console.error(`Erro ao salvar o arquivo CSV: ${error.message}`);
  }
}



/**
 * Função principal para executar a extração e salvamento.
 */
async function main() {
  const inputDirectory = './html_files';
  const outputFile = 'output.csv';
  const allData = [];

 
  

  // Verificar se o diretório de entrada existe
  if (!fs.existsSync(inputDirectory)) {
    console.error(`Diretório de entrada não encontrado: ${inputDirectory}`);
    return;
  }

  fs.readdirSync(inputDirectory).forEach((file) => {
    if (path.extname(file).toLowerCase() === '.html') {
      const filePath = path.join(inputDirectory, file);

      // Extrai dados do arquivo HTML
      const fileData = scrapeDataFromHtml(filePath);

      if (fileData.length === 0) {
        console.warn(`Nenhum dado extraído de ${file}. Movendo para a pasta 'unprocessed_files'.`);
        const unprocessedDir = path.join(__dirname, 'unprocessed_files');
        if (!fs.existsSync(unprocessedDir)) {
          fs.mkdirSync(unprocessedDir);
        }
        const destinationPath = path.join(unprocessedDir, file);
        fs.renameSync(filePath, destinationPath);
        console.log(`Arquivo movido para ${destinationPath}`);
      } else {
        allData.push(...fileData);

        // Move o arquivo processado para a pasta 'checked_files'
        const checkedFilesDir = path.join(__dirname, 'checked_files');
        if (!fs.existsSync(checkedFilesDir)) {
          fs.mkdirSync(checkedFilesDir);
        }
        const destinationPath = path.join(checkedFilesDir, file);
        fs.renameSync(filePath, destinationPath);
        console.log(`Arquivo ${file} movido para ${destinationPath}`);
      }
    }
  });

  // Salva todos os dados no arquivo CSV final
  if (allData.length > 0) {
    saveToCsv(allData, outputFile);
  } else {
    console.log('Nenhum dado extraído de nenhum arquivo.');
  }
}

main(); // Executa a função principal

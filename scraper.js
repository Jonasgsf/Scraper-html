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
    (/case\s*details/i.test(textContent)||/case\s*detail/i.test(textContent)) &&
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
        let datePart = courtDatestr;
      
        // Mapeamento de meses em galês para inglês
        const welshToEnglishMonths = {
          'Ionawr': 'January',
          'Chwefror': 'February',
          'Mawrth': 'March',
          'Ebrill': 'April',
          'Mai': 'May',
          'Mehefin': 'June',
          'Gorffennaf': 'July',
          'Awst': 'August',
          'Medi': 'September',
          'Hydref': 'October',
          'Tachwedd': 'November',
          'Rhagfyr': 'December'
        };
      
        // Se a data contiver uma vírgula, extrai a parte após a vírgula
        if (courtDatestr.includes(',')) {
          const parts = courtDatestr.split(',');
          for (let part of parts) {
            part = part.trim();
      
            // Substitui meses em galês por inglês
            for (const [welsh, english] of Object.entries(welshToEnglishMonths)) {
              const regex = new RegExp(`\\b${welsh}\\b`, 'gi');
              part = part.replace(regex, english);
            }
      
            // Remove sufixos ordinais como 'st', 'nd', 'rd', 'th'
            part = part.replace(/(\d+)(st|nd|rd|th)/i, '$1');
      
            // Tenta criar um objeto Date
            const date = new Date(part);
      
            // Verifica se a data é válida
            if (!isNaN(date)) {
              const day = String(date.getDate()).padStart(2, '0'); // Adiciona zero à esquerda
              const month = String(date.getMonth() + 1).padStart(2, '0'); // Mês começa em 0
              const year = date.getFullYear();
      
              return `${day}/${month}/${year}`;
            }
          }
        }
      
        console.error(`Data inválida: ${courtDatestr}`);
        return '';
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
  let titlename = '';
  // pegar o título com base no template
  titlename = $('title').text().trim(); // Seleciona o título para o template
  const data = [];
  const rows = table.find('tr');

  let headersIndex = {};

  rows.each((i, row) => {
    let cells = $(row).find('th, td');
    let cellsText = [];

    cells.each((j, cell) => {
      // Extrair o texto de cada parágrafo dentro da célula
      let cellLines = [];
      $(cell)
        .find('p')
        .each((k, p) => {
          let lineText = $(p).text().trim().replace(/\s+/g, ' ');
          if (lineText) cellLines.push(lineText); // Adicionar apenas se não estiver vazio
        });

      // Concatenar as linhas individuais em uma string final para a célula
      cellsText.push(cellLines.join(' | ')); // Usar ' | ' para separar linhas internas
    });

    // Identificar os índices dos cabeçalhos
    if (
      cellsText.some((text) =>
        /claim\s*number claimant/i.test(normalizeText(text))
      )
    ) {
      // Mapear os índices dos cabeçalhos considerando o colspan
      let logicalIndex = 0;

      cells.each((j, cell) => {
        let headerText = normalizeText($(cell).text());
        let colspan = parseInt($(cell).attr('colspan')) || 1;

        if (/^claim\s*number claimant$/i.test(headerText)) {
          headersIndex.claimNumber = logicalIndex;
          headersIndex.claimant = logicalIndex + 1;
        } else if (/^time$/i.test(headerText)) {
          headersIndex.time = logicalIndex;
        } else if (/^(defendant|respondent)$/i.test(headerText)) {
          headersIndex.defendant = logicalIndex;
        }

        logicalIndex += colspan;
      });

      console.log('Cabeçalhos encontrados (template4a):', headersIndex);
    } else if (cellsText.length > 1 && Object.keys(headersIndex).length > 0) {
      // Linha de dados válida
      if (cellsText.every((text) => text === '')) return;
      function splitAtFirstPipe(text) {
        const [firstPart, ...rest] = text.split(/ \| /);
        return [firstPart.trim(), rest.join(' | ').trim()];
      }
      const time = cellsText[0] || '';
      const claimNumber = cellsText[1] || '';

      let claimant = '';
      let defendant = '';

      if (cellsText.length === 3) {
        const claimantANDdefendant = cellsText[2] || '';
        [claimant, defendant] = splitAtFirstPipe(claimantANDdefendant);
        if (claimant === 'Phoenix  Community  Housing | Association | (Bellingham & | Downham) | Limited') {
          claimant = claimant.replace(/\|/g, '');
          defendant = defendant.replace(/\|/g, '');
        }

        if (defendant === '') {
          defendant = 'Not Provided';
        }
        if (claimant === '') {
          claimant = 'Not Provided';
        }
      } else {
        claimant = cellsText[2] || 'Not Provided';
        defendant = cellsText[3] || 'Not Provided';
        claimant = claimant.replace(/\|/g, '');
        defendant = defendant.replace(/\|/g, '');
      }

      console.log(cellsText);
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
        let datePart = courtDatestr;
      
        // Mapeamento de meses em galês para inglês
        const welshToEnglishMonths = {
          'Ionawr': 'January',
          'Chwefror': 'February',
          'Mawrth': 'March',
          'Ebrill': 'April',
          'Mai': 'May',
          'Mehefin': 'June',
          'Gorffennaf': 'July',
          'Awst': 'August',
          'Medi': 'September',
          'Hydref': 'October',
          'Tachwedd': 'November',
          'Rhagfyr': 'December'
        };
      
        // Se a data contiver uma vírgula, extrai a parte após a vírgula
        if (courtDatestr.includes(',')) {
          const parts = courtDatestr.split(',');
          for (let part of parts) {
            part = part.trim();
      
            // Substitui meses em galês por inglês
            for (const [welsh, english] of Object.entries(welshToEnglishMonths)) {
              const regex = new RegExp(`\\b${welsh}\\b`, 'gi');
              part = part.replace(regex, english);
            }
      
            // Remove sufixos ordinais como 'st', 'nd', 'rd', 'th'
            part = part.replace(/(\d+)(st|nd|rd|th)/i, '$1');
      
            // Tenta criar um objeto Date
            const date = new Date(part);
      
            // Verifica se a data é válida
            if (!isNaN(date)) {
              const day = String(date.getDate()).padStart(2, '0'); // Adiciona zero à esquerda
              const month = String(date.getMonth() + 1).padStart(2, '0'); // Mês começa em 0
              const year = date.getFullYear();
      
              return `${day}/${month}/${year}`;
            }
          }
        }
      
        console.error(`Data inválida: ${courtDatestr}`);
        return '';
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
    if (cellsText.some((text) => /start\s*time/i.test(normalizeText(text)))) {
      let logicalIndex = 0;
    
      dataCells.each((j, cell) => {
        let headerText = normalizeText($(cell).text());
        let colspan = parseInt($(cell).attr('colspan')) || 1;
    
        if (/start\s*time/i.test(headerText)) {
          headersIndex.startTime = logicalIndex;
        } else if (/duration/i.test(headerText)) {
          headersIndex.duration = logicalIndex;
        } else if (/case\s*detail(s)?/i.test(headerText)) {
          headersIndex.caseDetails = logicalIndex;
        } else if (/hearing\s*type/i.test(headerText)) {
          headersIndex.hearingType = logicalIndex;
        } else if (/hearing\s*channel/i.test(headerText)) {
          headersIndex.hearingChannel = logicalIndex;
        }
    
        logicalIndex += colspan;
      });
    

      console.log('Cabeçalhos encontrados (template5):', headersIndex);
    } else if (cellsText.length > 1 && Object.keys(headersIndex).length > 0) {
      if (cellsText.every((text) => text === '')) return;

      // Captura apenas as linhas que contêm "Possession" no Case Details
      let hearingType = cellsText[5];
      if (!/possessions?/i.test(hearingType)) {
        // Caso não encontre, tenta na posição 3
        hearingType = cellsText[3];
        if (!/possessions?/i.test(hearingType)) {
          // Caso ainda não encontre, tenta na posição 6
          hearingType = cellsText[6];
          if (!/possessions?/i.test(hearingType)) return;
        }
      
      };
      let startTime = cellsText[2];
      let duration = cellsText[3];
      let caseDetails = cellsText[4];
      let hearingChannel = cellsText[6];
      if(hearingType === cellsText[3]){
        startTime = cellsText[0];
        duration = cellsText[1];
        caseDetails = cellsText[2];
        hearingChannel = cellsText[4];
      } else if(hearingType === cellsText[6]){
        startTime = cellsText[3];
        duration = cellsText[4];
        caseDetails = cellsText[5];
        hearingChannel = cellsText[7];
      }
      const claimNumber = caseDetails.split(' ')[0];
      // Verificando se claimNumber é válido
      if (claimNumber === 'PCOL') return;

      caseDetails = caseDetails.replace(/^[A-Z0-9]+ /, '');

      let claimant = '';
      let defendant = '';

      // Separar o texto do 'caseDetails' para identificar o 'Claimant' e 'Defendant'
      if (/\s+(v|vs)\s+/i.test(caseDetails) || /\s+(-v-|-vs-)\s+/i.test(caseDetails)) {
        let parts = caseDetails.split(/\s+(v|vs)\s+/i);
        if (/\s+(-v-|-vs-)\s+/i.test(caseDetails)) {
          parts = caseDetails.split(/\s+(-v-|-vs-)\s+/i);
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
        let datePart = courtDatestr;
      
        // Mapeamento de meses em galês para inglês
        const welshToEnglishMonths = {
          'Ionawr': 'January',
          'Chwefror': 'February',
          'Mawrth': 'March',
          'Ebrill': 'April',
          'Mai': 'May',
          'Mehefin': 'June',
          'Gorffennaf': 'July',
          'Awst': 'August',
          'Medi': 'September',
          'Hydref': 'October',
          'Tachwedd': 'November',
          'Rhagfyr': 'December'
        };
      
        // Mantém a lógica próxima do original:
        // Se há vírgula, extrai a parte após a primeira vírgula
        if (courtDatestr.includes(',')) {
          const parts = courtDatestr.split(',');
          // Lógica original: pegar a parte após a vírgula (neste caso, [1])
          let candidate = parts[1] ? parts[1].trim() : courtDatestr.trim();
      
          // Substitui meses galeses, se houver
          for (const [welsh, english] of Object.entries(welshToEnglishMonths)) {
            const regex = new RegExp(`\\b${welsh}\\b`, 'gi');
            candidate = candidate.replace(regex, english);
          }
      
          // Remove sufixos ordinais
          candidate = candidate.replace(/(\d+)(st|nd|rd|th)/i, '$1');
      
          let date = new Date(candidate);
      
          // Se ainda for inválido, tente fallback com outra parte (por exemplo a parte [3]),
          // caso exista. Isso permite que, se a parte original não funcionar, 
          // uma parte posterior em inglês puro possa ser utilizada, sem quebrar templates antigos.
          if (isNaN(date) && parts[3]) {
            let fallback = parts[3].trim();
            fallback = fallback.replace(/(\d+)(st|nd|rd|th)/i, '$1');
            const fallbackDate = new Date(fallback);
            if (!isNaN(fallbackDate)) {
              date = fallbackDate;
            }
          }
      
          if (isNaN(date)) {
            console.error(`Data inválida: ${courtDatestr}`);
            return '';
          }
      
          const day = String(date.getDate()).padStart(2, '0');
          const month = String(date.getMonth() + 1).padStart(2, '0');
          const year = date.getFullYear();
      
          return `${day}/${month}/${year}`;
        } else {
          // Caso não haja vírgula, mantém a lógica original
          datePart = datePart.replace(/(\d+)(st|nd|rd|th)/i, '$1');
          const date = new Date(datePart);
      
          if (isNaN(date)) {
            console.error(`Data inválida: ${datePart}`);
            return '';
          }
      
          const day = String(date.getDate()).padStart(2, '0');
          const month = String(date.getMonth() + 1).padStart(2, '0');
          const year = date.getFullYear();
      
          return `${day}/${month}/${year}`;
        }
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
        const parts = caseName.split(/\s+(v|vs)\s+/i);
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
        let datePart = courtDatestr;
      
        // Mapeamento de meses em galês para inglês
        const welshToEnglishMonths = {
          'Ionawr': 'January',
          'Chwefror': 'February',
          'Mawrth': 'March',
          'Ebrill': 'April',
          'Mai': 'May',
          'Mehefin': 'June',
          'Gorffennaf': 'July',
          'Awst': 'August',
          'Medi': 'September',
          'Hydref': 'October',
          'Tachwedd': 'November',
          'Rhagfyr': 'December'
        };
      
        // Se a data contiver uma vírgula, extrai a parte após a vírgula
        if (courtDatestr.includes(',')) {
          const parts = courtDatestr.split(',');
          for (let part of parts) {
            part = part.trim();
      
            // Substitui meses em galês por inglês
            for (const [welsh, english] of Object.entries(welshToEnglishMonths)) {
              const regex = new RegExp(`\\b${welsh}\\b`, 'gi');
              part = part.replace(regex, english);
            }
      
            // Remove sufixos ordinais como 'st', 'nd', 'rd', 'th'
            part = part.replace(/(\d+)(st|nd|rd|th)/i, '$1');
      
            // Tenta criar um objeto Date
            const date = new Date(part);
      
            // Verifica se a data é válida
            if (!isNaN(date)) {
              const day = String(date.getDate()).padStart(2, '0'); // Adiciona zero à esquerda
              const month = String(date.getMonth() + 1).padStart(2, '0'); // Mês começa em 0
              const year = date.getFullYear();
      
              return `${day}/${month}/${year}`;
            }
          }
        }
      
        console.error(`Data inválida: ${courtDatestr}`);
        return '';
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
  
    // Lógica original para capturar courtName
    if (/court at/i.test(text) || /sitting at/i.test(text)) {
      const parts = text.split(/court at|sitting at/i);
      if (parts.length > 1) {
        courtName = parts[1].trim();
      }
    }
  
    // Padrão original para datas com vírgula (mantido)
    const datePattern = /^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),\s+\d{1,2}(?:st|nd|rd|th)?\s+\w+\s+\d{4}$/i;
    if (datePattern.test(text)) {
      courtDate = text;
    }
  
    // Fallback para formato bilíngue com "Monday" (ou outro dia em inglês)
    if (!courtDate && /Dydd\s+\w+,\s*\d{1,2}/i.test(text) && /(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)/i.test(text)) {
      const parts = text.split(',').map(part => part.trim());
      if (parts.length > 3) {
        let candidate = parts[3]; // Por ex: "18 November 2024"
        candidate = candidate.replace(/(\d+)(st|nd|rd|th)/i, '$1');
        const testDate = new Date(candidate);
        if (!isNaN(testDate)) {
          courtDate = candidate;
        }
      }
    }
  
    // Se ainda está vazio, tenta o fallback para datas sem vírgula em inglês, ex: "Monday 11th November 2024"
    if (courtDate === '') {
      // Padrão para datas sem vírgula: "Monday 11th November 2024"
      const noCommaPattern = /^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s+\d{1,2}(st|nd|rd|th)?\s+\w+\s+\d{4}$/i;
      if (noCommaPattern.test(text)) {
        let candidate = text.replace(/(\d+)(st|nd|rd|th)/i, '$1');
        const testDate = new Date(candidate);
        if (!isNaN(testDate)) {
          courtDate = candidate;
        }
      }
    }
    if (!courtDate) {
      // Novo fallback para data pura, ex: "15TH November 2024"
      const pureDatePattern = /^\d{1,2}(st|nd|rd|th)?\s+\w+\s+\d{4}$/i;
      if (pureDatePattern.test(text)) {
        let candidate = text.replace(/(\d+)(st|nd|rd|th)/i, '$1'); // Remove sufixos ordinais
    
        // Agora candidate é algo como "15 November 2024"
        // O new Date() pode não reconhecer bem "DD Month YYYY" sem vírgula.
        // Vamos reformatar para "Month DD, YYYY" antes de criar a data.
        candidate = candidate.replace(/^(\d{1,2})\s+(\w+)\s+(\d{4})$/i, (match, d, mon, y) => `${mon} ${d}, ${y}`);
    
        const testDate = new Date(candidate);
        if (!isNaN(testDate)) {
          courtDate = candidate; // agora temos uma data válida
        }
      }
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
      const tableText = $(this).text().toLowerCase().replace(/\s+/g, ' ');
  
      return (
        /(amser\s*cychwyn\s*,\s*)?start\s*time/i.test(tableText) &&
        /(hyd,\s*)?duration/i.test(tableText) &&
        /(manylion\s*yr\s*achos,\s*)?case\s*detail(s)?/i.test(tableText) &&
        /(math\s*o\s*wrandawiad,\s*)?hearing\s*type/i.test(tableText) &&
        /(sianel\s*clyw,\s*)?hearing\s*channel/i.test(tableText)
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
 /**
 * Função para salvar dados em um arquivo CSV.
 *
 * @param {Array} data - Array de objetos com os dados a serem salvos.
 */
function saveToCsv(data) {
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

    // Adiciona a data atual ao nome do arquivo
    const now = new Date();
    const dateSuffix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const outputFileName = `output_${dateSuffix}.csv`;

    fs.writeFileSync(outputFileName, csvContent);
    console.log(`Dados salvos em ${outputFileName}`);
  } catch (error) {
    console.error(`Erro ao salvar o arquivo CSV: ${error.message}`);
  }
}



/**
 * Função principal para executar a extração e salvamento.
 */
/**
 * Função principal para executar a extração e salvamento.
 */
async function main() {
  const inputDirectory = './html_files';
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
    saveToCsv(allData);
  } else {
    console.log('Nenhum dado extraído de nenhum arquivo.');
  }
}

main(); // Executa a função principal




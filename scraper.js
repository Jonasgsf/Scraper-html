const fs = require('fs');
const cheerio = require('cheerio');
const path = require('path');
const { REFUSED } = require('dns');

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
  const hasCombinedHeader = $('table')
    .find('th, td')
    .filter(function () {
      return normalizeText($(this).text()) === 'claim number claimant';
    }).length > 0;

  if (hasCombinedHeader) {
    return 'template4a';
  }

  // Template4: Verifica se existe 'claim number' ou variações, mas sem o cabeçalho combinado
  if (/claim\s*number/i.test(textContent)) {
    return 'template4';
  }

  // Caso nenhum template seja identificado, retornar null
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
      const claimant = cellsText[headersIndex.claimant] || '';
      const defendant = cellsText[headersIndex.defendant] || '';

      // Logs para depuração
      console.log(`Linha ${i}:`, {
        claimNumber,
        claimant,
        defendant,
      });

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
      cellsText.some((text) =>
        /claim\s*number claimant/i.test(normalizeText(text))
      )
    ) {
      // Mapear os índices dos cabeçalhos considerando o colspan
      let logicalIndex = 0;

      cells.each((j, cell) => {
        let headerText = normalizeText($(cell).text());
        let colspan = parseInt($(cell).attr('colspan')) || 1;

        // Verificar se o headerText contém 'Claim Number Claimant'
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
      // Verificar se a linha é uma linha de dados válida
      if (cellsText.every((text) => text === '')) return;

      // Extrair dados das linhas de dados
      const claimNumber = cellsText[headersIndex.claimNumber] || '';
      const claimant = cellsText[headersIndex.claimant] || '';
      const defendant = cellsText[headersIndex.defendant] || '';

      // Logs para depuração
      console.log(`Linha ${i}:`, {
        claimNumber,
        claimant,
        defendant,
      });

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
      let caseDetails = cellsText[4]
      const claimNumber = caseDetails.split(" ")[0];
      const hearingChannel = cellsText[6];

      //verificando se clainumber é válido
      if (claimNumber === "PCOL") return;

      
      
      caseDetails = caseDetails.replace(/^[A-Z0-9]+ /, "")
      
      let claimant = '';
      let defendant = '';

      // Separar o texto do 'caseDetails' para identificar o 'Claimant' e 'Defendant'
      if (/\s+(v|vs)\s+/i.test(caseDetails)) {
        const parts = caseDetails.split(/\s+(v|vs)\s+/i);
        if (parts.length >= 2) {
          claimant = parts[0].trim();
          
          defendant = parts[2].trim();
        } else {
          claimant = parts[0].trim();
          defendant = 'Not Provided';
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
        } else if (/^duration$/i.test(headerText)) {  // Corrigido para capturar corretamente "Duration"
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
        } else {
          claimant = parts[0].trim();
          defendant = 'Not Provided';
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
      };

      data.push(rowData);
    }
  });

  return data;
}


/**
 * Função para extrair dados da tabela para outros templates (exemplo: template5).
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
    if (/court at/i.test(text)) {
      const parts = text.split(/court at/i);
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
    tables = $('table').filter(function () {
      const tableText = $(this).text().toLowerCase();
      return (
        /claim\s*number claimant/i.test(tableText) &&
        /defendant/i.test(tableText)
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

  const processedTables = new Set(); // Controlar tabelas processadas
  const processedClaimNumbers = new Set(); // Controlar `Claim Numbers` já extraídos

  tables.each((tableIndex, tableElem) => {
    if (!processedTables.has(tableElem)) {
      processedTables.add(tableElem); // Marca a tabela como processada
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

            // Escapa os dados da célula se contiver vírgulas ou aspas
            return `"${cellData.replace(/"/g, '""')}"`;
          });

          return formattedRow.join(',');
        })
      )
      .join('\n');

    fs.writeFileSync(outputPath, csvContent); // Escreve no arquivo CSV
    console.log(`Dados salvos em ${outputPath}`);
  } catch (error) {
    console.error(`Erro ao salvar o arquivo CSV: ${error.message}`);
  }
}

/**
 * Função principal para executar a extração e salvamento.
 */
function main() {
  const inputDirectory = './html_files'; // Diretório de entrada (alterar conforme necessário)
  const outputFile = 'output.csv'; // Nome do arquivo de saída (alterar conforme necessário)
  const allData = []; // Array para armazenar todos os dados

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
      allData.push(...fileData); // Adiciona dados ao array
    }
  });

  saveToCsv(allData, outputFile); // Salva todos os dados em um arquivo CSV
}

main(); // Executa a função principal

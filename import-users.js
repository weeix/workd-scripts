const fs = require('fs').promises;
const { stringify } = require('csv-stringify/sync');
const puppeteer = require('puppeteer');

const { 
  promptCredential,
  handleError,
  validateFiletype,
  logInWorkD,
  importWorkDUsers,
  openUserManagementPage,
  getArguments
} = require('./common/functions');

(async () => {
  let browser, page;
  try {
    const args = getArguments(1);
    const inputFilePath = args[0];
    validateFiletype(inputFilePath, ['csv']);
    const outputFilePath = inputFilePath.replace(/\.csv$/gi,'_imported.csv');

    console.log('info: reading CSV file');
    const inputFile = await fs.readFile(inputFilePath);

    const credential = await promptCredential();

    browser = await puppeteer.launch({ headless: false, slowMo: 20 });
    page = await browser.newPage();
    
    await logInWorkD(page, credential.username, credential.password);
    await openUserManagementPage(page);
    const importedUsers = await importWorkDUsers(page, inputFile);
    console.log('info: writing CSV file');
    const contentCsv = stringify(importedUsers, {bom: true, header: true });
    await fs.writeFile(outputFilePath, contentCsv);

  } catch (error) {
    handleError(error);
  } finally {
    if (browser != null) {
      await browser.close();
    }
  }
})();

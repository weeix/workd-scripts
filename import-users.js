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

    const credential = await promptCredential();

    browser = await puppeteer.launch();
    page = await browser.newPage();
    
    await logInWorkD(page, credential.username, credential.password);
    await openUserManagementPage(page);
    await importWorkDUsers(page, inputFilePath, outputFilePath);

  } catch (error) {
    handleError(error);
  } finally {
    if (browser != null) {
      await browser.close();
    }
  }
})();

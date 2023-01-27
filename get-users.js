const fs = require('fs').promises;
const { stringify } = require('csv-stringify/sync');
const puppeteer = require('puppeteer');

const { 
  promptCredential,
  handleError,
  validateFiletype,
  logInWorkD,
  getAllUser,
  openUserManagementPage
} = require('./common/functions');

(async () => {
  let browser, page;
  try {
    const args = process.argv.slice(2); // We don't need "node" and the script name
    let filePath = 'workdUsers.csv'; // default file path
    if (args.length > 0) {
      filePath = args[0];
      validateFiletype(filePath, ['csv']);
    }

    const credential = await promptCredential();

    browser = await puppeteer.launch();
    page = await browser.newPage();
    
    await logInWorkD(page, credential.username, credential.password);
    await openUserManagementPage(page);
    const users = await getAllUser(page);
    console.log('info: writing CSV file');
    const contentCsv = stringify(users, {bom: true, header: true });
    await fs.writeFile(filePath, contentCsv);
  } catch (error) {
    handleError(error);
  } finally {
    if (browser != null) {
      await browser.close();
    }
  }
})();

const fs = require('fs');
const path = require('path');
const prompt = require('prompt');
const puppeteer = require('puppeteer');
const { parse } = require('csv-parse/sync');
const { stringify } = require('csv-stringify');
var {
  Credential,
  ArgumentError,
  WorkDLogInError,
  WorkDCreateUserError,
  WorkDInsufficientQuotaError
} = require('./classes');

// -------------------
// Functions
// -------------------

/**
 * ดึงข้อมูล argument
 * 
 * @param {number} count จำนวน argument ที่ต้องการ
 * @returns argument ที่ดึงมา
 */
function getArguments(count) {
  const args = process.argv.slice(2); // We don't need "node" and the script name

  // check arguments
  if (args.length !== count) {
      throw new ArgumentError(`Expected ${count} argument(s)`)
  }

  return args;
}

/**
 * ตรวจสอบนามสกุลของไฟล์
 * 
 * @param {string} filePath ที่อยู่ไฟล์
 * @param {string[]} allowedFiletypes นามสกุลไฟล์ทั้งหมดที่อนุญาต
 * @returns 
 */
function validateFiletype(filePath, allowedFiletypes) {
  for (const allowedFiletype of allowedFiletypes) {
    const fileType = path.extname(filePath).toLowerCase();
    if (fileType === `.${allowedFiletype}`) {
      return;
    }
  }
  throw new ArgumentError(`Invalid file type. Allowed file type(s): ${allowedFiletypes.toString()}`)
}

/**
 * ถาม username/password ผ่าน command prompt
 * 
 * @returns บัญชีผู้ใช้และรหัสผ่าน
 */
async function promptCredential() {
  console.log('Enter your credential');
  prompt.start();
  ({ username, password } = await prompt.get({
    properties: {
      username: {
        description: 'Enter your username',
        required: true
      },
      password: {
        description: 'Enter your password',
        required: true,
        hidden: true,
        replace: '*'
      }
    }
  }));
  return new Credential(username, password);
}

/**
 * เข้าสู่ระบบ workD
 * หากเข้าสู่ระบบสำเร็จ จะเข้าสู่หน้า Web Portal
 * 
 * @param {puppeteer.Page} page 
 * @param {string} username
 * @param {string} password
 */
async function logInWorkD(page, username, password) {
  await page.goto('https://workd.go.th/saml/login');
  await page.waitForSelector('#userNameInput');
  await page.type('#userNameInput', username);
  await page.type('#passwordInput', password);
  await page.click('#submitButton');
  const result = await Promise.race([
    page.waitForSelector('xpath///div[contains(., "Web Portal")]'),
    page.waitForSelector('#errorText')
  ]);
  const resultText = await result.evaluate(el => el.textContent);
  if (resultText !== 'Web Portal') {
    throw new WorkDLogInError(resultText);
  }
  console.log('info: logged in');
}

/**
 * เปิดหน้าจัดการผู้ใช้ (เริ่มจากหน้า Web Portal)
 * 
 * @param {puppeteer.Page} page 
 */
async function openUserManagementPage(page) {
  const selectorUserManagementButton = 'xpath///h3[contains(., "จัดการผู้ใช้งาน")]';
  await page.waitForSelector(selectorUserManagementButton);
  await page.click(selectorUserManagementButton);
  await page.waitForSelector('xpath///h1[text()="ผู้ใช้งาน"]');
  console.log('info: opened user management page');
}

/**
 * เปิดหน้าเพิ่มผู้ใช้ (เริ่มจากหน้าจัดการผู้ใช้)
 * 
 * @param {puppeteer.Page} page 
 */
async function openUserAddPage(page) {
  const userAddButton = await page.waitForSelector('xpath///a[contains(.,"เพิ่มผู้ใช้งาน")]');
  await userAddButton.click();
  await page.waitForSelector('xpath///input[@name="email"]');
  console.log('info: opened user add page');
}

/**
 * รายการผู้ใช้ทั้งหมด (เริ่มจากหน้า จัดการผู้ใช้งาน)
 * 
 * @param {puppeteer.Page} page
 * @returns {Promise<Array<any>>} รายการผู้ใช้
 */
async function getAllUser(page) {
  console.log('info: trying to get all users');
  let users = [];
  let currentPage = 1
  while (currentPage > 0) {
    console.log(`info: processing page ${currentPage}`);
    await page.waitForSelector('.table-body');
    const usersInPage = await page.evaluate(evalGetAllUserInPage);
    users = users.concat(usersInPage);
    await page.evaluate(evalClearAllUserInPage);
    // try to click next page number button
    currentPage++;
    const pageNumberButtons = await page.$x(`//div[text()="${currentPage}"]`);
    if (pageNumberButtons.length > 0) {
      await pageNumberButtons[0].click();
    } else {
      currentPage = 0;
    }
  }
  return users;
}

/**
 * นำเข้าบัญชีผู้ใช้ workD จากไฟล์ csv (เริ่มจากหน้า จัดการผู้ใช้งาน)
 * 
 * @param {puppeteer.Page} page 
 * @param {string} inputFilePath ที่อยู่ไฟล์ csv ที่จะนำเข้า
 * @param {string} outputFilePath ที่อยู่ไฟล์ csv ที่จะบันทึกรายการบัญชีผู้ที่นำเข้าแล้วพร้อมรหัสผ่าน
 * @returns {Promise<Array<any>>}
 */
async function importWorkDUsers(page, inputFilePath, outputFilePath) {
  console.log('info: processing CSV file');
  const inputFile = await fs.promises.readFile(inputFilePath);
  const records = parse(inputFile, {
    bom: true,
    columns: true
  });
  const outputFileStream = fs.createWriteStream(outputFilePath);
  const stringifier = stringify({
    header: true,
    columns: [
      'username',
      'password',
      'fname_th',
      'lname_th',
      'fname_en',
      'lname_en',
      'tel',
      'mobile',
      'cid',
      'secondary_email',
      'note'
    ]
  });
  stringifier.pipe(outputFileStream);
  const importedUsers = [];
  for (const record of records) {
    // trycatch inside the loop, so it could continue when an error occured
    try {
      let username = record.username.trim();
      if (username.indexOf('@') !== -1) {
        username = username.substring(0, username.indexOf('@'));
      }
      const fnameTH = record.fname_th.trim();
      const lnameTH = record.lname_th.trim();
      const fnameEN = record.fname_en.trim();
      const lnameEN = record.lname_en.trim();
      const displayName = fnameTH + ' ' + lnameTH;
      const cid = record.cid.trim();
      const secondaryEmail = record.secondary_email.trim();
      const tel = record.tel.trim();
      const mobile = record.mobile.trim();
      await openUserAddPage(page);
      await page.type('xpath///input[@name="email"]', username);
      await page.type('xpath///input[@name="display_name"]', displayName);
      await page.type('xpath///input[@name="first_name_th"]', fnameTH);
      await page.type('xpath///input[@name="last_name_th"]', lnameTH);
      await page.type('xpath///input[@name="first_name_en"]', fnameEN);
      await page.type('xpath///input[@name="last_name_en"]', lnameEN);
      await page.type('xpath///input[@name="id_card_no"]', cid);
      await page.type('xpath///input[@name="secondary_email"]', secondaryEmail);
      await page.click('xpath///p[contains(.,"ข้อมูลติดต่อ")]');
      await page.waitForSelector('xpath///input[@name="telephone"]');
      await page.type('xpath///input[@name="telephone"]', tel);
      await page.type('xpath///input[@name="mobile_phone"]', mobile);
      await page.click('xpath///p[contains(.,"สิทธิ์บทบาท")]');
      await page.waitForSelector('xpath///h2[text()="บทบาท"]');
      await page.click('xpath///h2[text()="บทบาท"]/..//button');
      await page.waitForSelector('xpath///span[text()="Default"]');
      await page.click('xpath///span[text()="Default"]');
      await page.click('xpath///button[contains(.,"สร้างผู้ใช้งาน")]');
      const elementDialogTitle = await page.waitForSelector('.dialog-title');
      const textDialogTitle = await elementDialogTitle.evaluate(el => el.textContent);
      if (textDialogTitle !== 'สำเร็จ') {
        const elementDialogMessage = await page.waitForSelector('.dialog-message');
        const textDialogMessage = await elementDialogMessage.evaluate(el => el.textContent.replace(/[\n\r]/g, ' '));
        const errorMessage = username + ' -> ' + textDialogMessage;
        await page.click('xpath///button[contains(.,"ตกลง")]');
        await page.evaluate(() => document.querySelector('nav a').click());
        await page.waitForSelector('xpath///h1[text()="ผู้ใช้งาน"]');
        throw new WorkDCreateUserError(errorMessage);
      }
      await page.click('xpath///button[contains(.,"ตกลง")]');
      await page.waitForSelector('.table-body');
      await page.evaluate(evalClearAllUserInPage);
      await page.type('xpath///input[@name="search"]', username + '@');
      await page.waitForSelector('.table-body button');
      await page.click('.table-body button');
      await page.waitForSelector('xpath///button[contains(.,"เปลี่ยนรหัสผ่าน")]');
      await page.click('xpath///button[contains(.,"เปลี่ยนรหัสผ่าน")]');
      await page.waitForSelector('.modal-body .btn-primary');
      await page.click('.modal-body .btn-primary');
      const elementParagraphPassword = await page.waitForSelector('xpath///p[contains(.,"รหัสผ่าน: ")]');
      const password = await elementParagraphPassword.evaluate(el => el.textContent.replace("รหัสผ่าน: ", ""));
      await page.evaluate(() => document.querySelector('nav a').click());
      await page.waitForSelector('xpath///h1[text()="ผู้ใช้งาน"]');
      const importedUser = {
        username: username,
        password: password,
        fname_th: fnameTH,
        lname_th: lnameTH,
        fname_en: fnameEN,
        lname_en: lnameEN,
        tel: tel,
        mobile: mobile,
        cid: cid,
        secondary_email: secondaryEmail,
        note: record.note.trim()
      };
      stringifier.write(importedUser);
      importedUsers.push(importedUser);
      console.log(`info: added user (${username})`);
    } catch (error) {
      handleError(error);
    } finally {
      stringifier.end();
    }
  }
  return importedUsers;
}

/**
 * รวบรวมรายการผู้ใช้ทั้งหมดที่แสดงในหน้าปัจจุบัน
 * (ทำงานในหน้า https://workd.go.th/admin/users/list)
 * 
 * @returns {Array<any>} รายการผู้ใช้
 */
function evalGetAllUserInPage() {
  const users = [];
  const rows = document.querySelectorAll('tr.table-body');
  for (const row of rows) {
    const columns = row.querySelectorAll('td');
    var created = columns[4].textContent;
    var updated = columns[5].textContent;
    var loggedIn = columns[6].textContent;
    if (created.length > 10) {
      created = created.slice(0, 10) + " " + created.slice(10);
    }
    if (updated.length > 10) {
      updated = updated.slice(0, 10) + " " + updated.slice(10);
    }
    if (loggedIn.length > 10) {
      loggedIn = loggedIn.slice(0, 10) + " " + loggedIn.slice(10);
    }
    const user = {
      "displayName": columns[1].textContent,
      "fullName": columns[2].textContent,
      "email": columns[3].textContent,
      "created": created,
      "updated": updated,
      "loggedIn": loggedIn
    };
    users.push(user);
  }
  return users;
}

/**
 * ลบรายการผู้ใช้ทั้งหมดออกจากหน้า เพื่อให้ตรวจสอบได้ว่ามีการโหลดหน้าใหม่
 * (ทำงานในหน้า https://workd.go.th/admin/users/list)
 */
function evalClearAllUserInPage() {
  const rows = document.querySelectorAll('tr.table-body');
  for (const row of rows) {
    row.remove();
  }
}

/**
 * แสดงข้อความผิดพลาดที่เกิดขึ้น
 * @param {Error} error ข้อความผิดพลาด
 */
function handleError(error) {
  if (error instanceof WorkDLogInError) {
    console.error(`error: workD login failure (${error.message})`);
  } else if (error instanceof WorkDCreateUserError) {
    console.error(`error: failed to create user (${error.message})`);
  } else if (error instanceof WorkDInsufficientQuotaError) {
    console.error(`error: insufficient quota`);
  } else if (error instanceof ArgumentError) {
    console.error(`error: invalid argument(s) (${error.message})`);
  } else {
    throw error;
  }
}

module.exports = {
  getArguments,
  validateFiletype,
  promptCredential,
  logInWorkD,
  openUserManagementPage,
  getAllUser,
  importWorkDUsers,
  handleError
}

const {chromium}=require(process.env.BOMBERMAN_PLAYWRIGHT_PATH || 'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const base=process.env.BOMBERMAN_BASE_URL || 'http://127.0.0.1:50828';
(async()=>{
  const browser=await chromium.launch({headless:true});
  try {
    for(const [width,height] of [[390,844],[1280,900]]){
      const context=await browser.newContext({viewport:{width,height},hasTouch:true,isMobile:width<700,permissions:['clipboard-read','clipboard-write']});const page=await context.newPage();const errors=[],downloads=[],outgoing=[];
      page.on('pageerror',error=>errors.push(error.message));page.on('download',download=>downloads.push(download.suggestedFilename()));page.on('request',request=>outgoing.push(request.url()));
      await context.route('https://bomberman.shangganmieya.com/**',route=>route.fulfill({status:302,headers:{Location:'https://invalid.example/never-download.apk','Access-Control-Allow-Origin':'*'}}));
      await context.route('https://bomberman-4bs.pages.dev/**',async route=>route.fulfill({status:200,headers:{'Content-Type':'text/html','Access-Control-Allow-Origin':'*'},body:await fs.readFile('dist/index.html')}));
      await page.goto(base+'/connection-check');await page.locator('#network-kind').selectOption('wifi');await page.locator('#run-check').click();await page.locator('#report-section').waitFor({state:'visible'});
      const report=JSON.parse(await page.locator('#report').textContent());assert.equal(report.targets[0].results[0].kind,'redirect');assert.equal(report.targets[0].results[1].kind,'redirect');assert.equal(report.targets[1].results[1].matchesThisRelease,true);assert.equal(report.network,'wifi');assert.deepEqual(downloads,[]);assert.ok(!outgoing.some(url=>url.includes('never-download.apk')));assert.deepEqual(errors,[]);assert.ok(!JSON.stringify(report).includes('Cookie'));
      const bounds=await page.locator('.check-card').boundingBox();assert.ok(bounds.x>=0 && bounds.x+bounds.width<=width+.5);
      await page.locator('#copy-report').click();assert.ok((await page.evaluate(()=>navigator.clipboard.readText())).includes('"network": "wifi"'));
      await page.screenshot({path:path.resolve('verification/connection-check-'+width+'.png'),fullPage:true});console.log('PASS connection check '+width+'px detects redirect without following APK, copies sanitized report');await context.close();
    }
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});

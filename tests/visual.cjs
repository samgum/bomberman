const {chromium}=require(process.env.BOMBERMAN_PLAYWRIGHT_PATH || 'playwright');
const fs=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');
const base=process.env.BOMBERMAN_BASE_URL || 'http://127.0.0.1:50827';
const output=path.resolve('verification');
const report={screens:[],issues:[]};
const profiles=[['desktop',1440,900,false],['wide-desktop',2160,1200,false],['phone',390,844,true],['small-phone',320,568,true],['landscape-phone',667,375,true],['tablet',768,1024,true]];
(async()=>{
  const browser=await chromium.launch({headless:true});
  for(const [name,width,height,touch] of profiles.filter(profile=>!process.argv[2] || profile[0]===process.argv[2])){
    const context=await browser.newContext({viewport:{width,height},hasTouch:touch,isMobile:touch,deviceScaleFactor:touch?2:1});
    const page=await context.newPage();
    await page.goto(base);await page.waitForFunction(()=>document.documentElement.dataset.phase==='menu');
    await page.screenshot({path:path.join(output,'quality-'+name+'-new.png')});
    await page.locator('#start-button').click();
    await page.waitForTimeout(4600);await page.locator('#pause-button').click();
    await page.waitForFunction(()=>document.getElementById('pause-save-status').textContent.includes('已保存'));
    await page.locator('#menu-button').click();
    await page.waitForFunction(()=>document.documentElement.dataset.phase==='menu');
    await page.screenshot({path:path.join(output,'quality-'+name+'-saved.png')});
    const audit=await page.evaluate(()=>{
      const region=document.getElementById('game-window').getBoundingClientRect();
      const elements={};
      for(const id of ['menu-save-info','menu-save-title','continue-button','start-button','keyboard-guide','fullscreen-button']){
        const element=document.getElementById(id),rect=element.getBoundingClientRect(),style=getComputedStyle(element);
        elements[id]={font:parseFloat(style.fontSize),rect:{x:rect.x,y:rect.y,width:rect.width,height:rect.height},color:style.color};
      }
      const children=Array.from(document.querySelectorAll('.home-grid>*,.home-buttons>button'));
      const clipped=children.filter(element=>{
        const rect=element.getBoundingClientRect();
        return rect.top<region.top-.5 || rect.bottom>region.bottom+.5 || rect.left<region.left-.5 || rect.right>region.right+.5;
      }).map(element=>element.id || element.className);
      return {elements,clipped,region:{x:region.x,y:region.y,width:region.width,height:region.height}};
    });
    report.screens.push({name,viewport:{width,height},...audit});
    if(audit.clipped.length)report.issues.push({name,clipped:audit.clipped});
    await context.close();
  }
  await browser.close();
  const filename=process.argv[2]?'visual-'+process.argv[2]+'-report.json':'visual-report.json';
  await fs.writeFile(path.join(output,filename),JSON.stringify(report,null,2));
  console.log(JSON.stringify({screens:report.screens.length,issues:report.issues,report:path.join(output,filename)}));
  assert.deepEqual(report.issues,[],'No home artwork, saved-game card or primary button is clipped');
})().catch(error=>{console.error(error);process.exitCode=1;});

import fs from 'node:fs/promises';
import '../vendor/jsnes/jsnes.min.js';
const rom=await fs.readFile(new URL('../game/bomberman.nes',import.meta.url));
let frame;
const nes=new globalThis.jsnes.NES({emulateSound:false,onFrame:buffer=>{frame=Array.from(buffer);}});
nes.loadROM(rom);
for(let i=0;i<80;i++)nes.frame();
const rgb=value=>'#'+[value&255,(value>>8)&255,(value>>16)&255].map(part=>part.toString(16).padStart(2,'0')).join('');
function svg(rows) {
  const paths=new Map();
  rows.forEach((row,y)=>{
    for(let x=0;x<row.length;) {
      const value=row[x];let end=x+1;
      while(end<row.length && row[end]===value)end++;
      if(value!==null)paths.set(value,(paths.get(value)||'')+`M${x} ${y}h${end-x}v1h-${end-x}z`);
      x=end;
    }
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${rows[0].length} ${rows.length}" width="${rows[0].length}" height="${rows.length}" shape-rendering="crispEdges">${[...paths].map(([color,d])=>`<path fill="${rgb(color)}" d="${d}"/>`).join('')}</svg>\n`;
}
const candidates=[];
for(let y=0;y<144;y++)for(let x=0;x<256;x++)if(frame[y*256+x]!==0)candidates.push({x,y});
const left=Math.min(...candidates.map(pixel=>pixel.x)),right=Math.max(...candidates.map(pixel=>pixel.x));
const top=Math.min(...candidates.map(pixel=>pixel.y)),bottom=Math.max(...candidates.map(pixel=>pixel.y));
const title=[];
for(let y=top;y<=bottom;y++)title.push(frame.slice(y*256+left,y*256+right+1).map(value=>value===0?null:value));
await fs.writeFile(new URL('../assets/title.svg',import.meta.url),svg(title));
const chr=await fs.readFile(new URL('../vendor/bomberman-source/BOMBER.CHR',import.meta.url));
function sprite(number,palette) {
  const index=((number<<1)&14)|((number<<2)&224);
  const ids=[index,index+1,index+16,index+17];
  const rows=Array.from({length:16},()=>Array(16).fill(null));
  ids.forEach((id,quad)=>{
    for(let y=0;y<8;y++)for(let x=0;x<8;x++) {
      const value=((chr[id*16+y]>>(7-x))&1)|(((chr[id*16+y+8]>>(7-x))&1)<<1);
      if(value)rows[Math.floor(quad/2)*8+y][(quad%2)*8+x]=nes.ppu.sprPalette[palette*4+value];
    }
  });
  return rows;
}
await fs.writeFile(new URL('../assets/player.svg',import.meta.url),svg(sprite(3,0)));
await fs.writeFile(new URL('../assets/enemy.svg',import.meta.url),svg(sprite(0x18,1)));
console.log('Exported the original title and sprite pixels as SVG assets.');

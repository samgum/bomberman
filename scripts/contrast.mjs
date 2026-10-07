const colors={
  savedHint:['#c4d0d5','#14232e'],
  savedLabel:['#a8d5ab','#14232e'],
  heading:['#fff0bd','#14232e'],
  primaryButton:['#fff1d8','#b93d37'],
  keyboardHint:['#f3eddb','#1d2b34'],
  toolbar:['#f6efdb','#2c3d49']
};
function luminance(hex){
  const values=[1,3,5].map(index=>parseInt(hex.slice(index,index+2),16)/255).map(value=>value<=.04045?value/12.92:((value+.055)/1.055)**2.4);
  return values[0]*.2126+values[1]*.7152+values[2]*.0722;
}
const ratios=Object.fromEntries(Object.entries(colors).map(([name,[text,background]])=>{
  const a=luminance(text),b=luminance(background),ratio=(Math.max(a,b)+.05)/(Math.min(a,b)+.05);
  if(ratio<4.5)throw new Error(name+' needs more text contrast');
  return [name,Number(ratio.toFixed(2))];
}));
console.log(JSON.stringify(ratios,null,2));

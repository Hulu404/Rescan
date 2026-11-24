import {test,expect} from '@playwright/test';
// Labels are drawn by their measured proportions: 3.23 × 0.89 plate lengths, plate 0.95 left and 0.31 above the centre.
const FRAME={width:780,height:280};
async function detect(page,labels,extra=null){
 await page.goto('/');
 return page.evaluate(async({frame,labels,extra})=>{
  const {findFramedPlate,findModelPlate}=await import('/src/ocr/locate.js');
  const c=document.createElement('canvas');c.width=frame.width;c.height=frame.height;const x=c.getContext('2d');
  x.fillStyle='#e8e8ec';x.fillRect(0,0,c.width,c.height);x.fillStyle='#142a6e';
  for(const {cx,cy,L,turn=0} of labels){x.save();x.translate(cx,cy);x.rotate(turn);x.fillRect(-1.45*L,-.43*L,L,.24*L);x.restore();}
  if(extra)x.fillRect(extra.x,extra.y,extra.w,extra.h);
  const {plate,found}=findFramedPlate(c);
  return {plate,found,largest:findModelPlate(c)};
 },{frame:FRAME,labels,extra});
}
const L=230,MID={cx:390,cy:140,L};
test('label in the middle wins over a neighbour whose plate is cut by the frame',async({page})=>{
 const {plate}=await detect(page,[MID,{cx:390,cy:140+.92*L,L}]);
 expect(Math.abs(plate.cx-(390-.95*L))).toBeLessThan(3);
 expect(Math.abs(plate.cy-(140-.31*L))).toBeLessThan(3);
});
test('label in the middle wins over a whole, slightly larger neighbour',async({page})=>{
 const small={cx:390,cy:140,L:140},big={cx:390,cy:140-.92*140,L:150};
 const {plate,largest}=await detect(page,[small,{...big,cy:72}]);
 expect(largest.length).toBeGreaterThan(145);
 expect(Math.abs(plate.cy-(140-.31*140))).toBeLessThan(3);
});
test('upside-down label in the middle is accepted',async({page})=>{
 const {plate}=await detect(page,[{...MID,turn:Math.PI}]);
 expect(Math.abs(plate.cx-(390+.95*L))).toBeLessThan(3);
});
test('plate a few pixels from the frame edge is whole, not cut',async({page})=>{
 const {plate}=await detect(page,[{...MID,cy:2+.43*L}]);
 expect(plate).not.toBeNull();
});
test('cut or off-centre labels are reported as found but never returned',async({page})=>{
 expect(await detect(page,[{...MID,cy:.36*L}])).toMatchObject({plate:null,found:1});
 expect(await detect(page,[{cx:390,cy:250,L:200}])).toMatchObject({plate:null,found:1});
});
test('small navy print such as a logo is not a plate',async({page})=>{
 expect(await detect(page,[],{x:600,y:200,w:84,h:24})).toMatchObject({plate:null,found:0});
});
// The stub sees nothing in field windows and a neighbour's data when asked to read the whole page (PSM 3).
async function recognizeFramed(page,label,framed=true){
 await page.goto('/');
 return page.evaluate(async({frame,label,framed})=>{
  const {recognizeLabel}=await import('/src/ocr/recognize.js');
  const c=document.createElement('canvas');c.width=frame.width;c.height=frame.height;const x=c.getContext('2d');
  x.fillStyle='#e8e8ec';x.fillRect(0,0,c.width,c.height);x.fillStyle='#142a6e';x.fillRect(label.cx-1.45*label.L,label.cy-.43*label.L,label.L,.24*label.L);
  let mode='';
  const worker={setParameters:async p=>{mode=p.tessedit_pageseg_mode??mode;},recognize:async()=>({data:{text:mode==='3'?'MODEL ABX42\n+18.5 D\nSN 001234 007':'',confidence:0}})};
  const blob=await new Promise(r=>c.toBlob(r,'image/png'));
  const {fields,method,review}=await recognizeLabel(blob,worker,{framed});
  return {fields,method,flagged:Object.values(review).every(r=>r.needsCheck),note:review.serial.note};
 },{frame:FRAME,label,framed});
}
const EMPTY={model:'',power:'',serial:''};
test('unreadable label in the middle stays empty instead of taking values from the rest of the photo',async({page})=>{
 expect(await recognizeFramed(page,MID)).toMatchObject({fields:EMPTY,method:'unreadable',flagged:true});
});
test('off-centre label is not read and asks for a new shot',async({page})=>{
 const result=await recognizeFramed(page,{cx:390,cy:250,L:200});
 expect(result).toMatchObject({fields:EMPTY,method:'misframed',flagged:true});
 expect(result.note).toContain('переснимите');
});
test('gallery photo keeps the whole-image fallback',async({page})=>{
 expect(await recognizeFramed(page,MID,false)).toMatchObject({method:'whole-image',fields:{serial:'001234 007'}});
});

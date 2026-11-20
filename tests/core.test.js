import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import ExcelJS from 'exceljs';
import {parsePower,clinicDate,normalizeSerial} from '../shared/label.js';
import {parseModelText,parsePowerText,parseSerialText,vote,resolveZeroOh,modelAmbiguity,settleModel} from '../shared/fields.js';
import {validateTelegram,parseAllowedUsernames} from '../server/auth.js';
import {createDownloadToken,verifyDownloadToken,downloadKey,DOWNLOAD_TTL_SECONDS} from '../server/download.js';
import {createExcel} from '../server/excel.js';
test('power accepts signed decimal comma and dot, rejects partial garbage',()=>{
 for(const [input,expected] of [['+20.5 D',20.5],['−2,5',-2.5],['0',0],['-0.75',-.75]])assert.equal(parsePower(input),expected);
 for(const bad of ['', '20.5xyz','1,2.3','Infinity','101'])assert.throws(()=>parsePower(bad));
});
test('model comes from the #-plate or MODEL, never REF, and O/0 are not swapped',()=>{
 assert.equal(parseModelText('#CNWOT2 |'),'CNWOT2');
 assert.equal(parseModelText('#CNWoT2'),'CNWOT2');
 assert.equal(parseModelText('MODEL ABX42'),'ABX42');
 assert.equal(parseModelText('REF 8065123456'),'');
 assert.equal(parseModelText('Clareon TORIC'),'');
});
test('power needs D, skips cylinder/diameter/date, rejects implausible values',()=>{
 assert.equal(parsePowerText('[+20.5D ]'),'+20.5');
 assert.equal(parsePowerText('+20.5D CYL 1.50D'),'+20.5');
 assert.equal(parsePowerText('-2,5 D'),'-2.5');
 assert.equal(parsePowerText('+20.50'),'');
 assert.equal(parsePowerText('Ø 13.0mm 2030-01-25'),'');
 assert.equal(parsePowerText('+20.3D'),'');
 assert.equal(parsePowerText('+20D +3D'),'');
 // Labels always print the sign; unsigned digits next to D are fragments of other text.
 assert.equal(parsePowerText('4 D'),'');
 assert.equal(parsePowerText('He 0D'),'');
 assert.equal(parsePowerText('%8460v23909600( 10) 13-10 [d'),'');
 assert.equal(parsePowerText('+7.0 D CYL 2.25'),'+7');
});
test('serial is digits after SN only, keeps leading zeros, rejects letters and LOT',()=>{
 assert.equal(parseSerialText('| SN 26187115 027 UDI'),'26187115 027');
 assert.equal(parseSerialText('SN 001234 007'),'001234 007');
 // OCR drops the gap between Alcon's 8+3 groups; only spacing is restored, never digits.
 assert.equal(parseSerialText('[SN] 26168203001 [UDI]'),'26168203 001');
 assert.equal(parseSerialText('SN 0012340070'),'0012340070');
 // Window already on the SN row: the boxed tag may be missing, the rest stays strict.
 assert.equal(parseSerialText('16205948 025 [U'),'');
 assert.equal(parseSerialText('16205948 025 [U',{requireTag:false}),'16205948 025');
 assert.equal(parseSerialText('| 26174807 015 [Ul',{requireTag:false}),'26174807 015');
 assert.equal(parseSerialText('[8N] 16206097 059 [ui',{requireTag:false}),'16206097 059');
 assert.equal(parseSerialText('26168203 001 [UL',{requireTag:false}),'26168203 001');
 assert.equal(parseSerialText('2018/1195 VZ/ ur',{requireTag:false}),'');
 assert.equal(parseSerialText('RW A EN GE',{requireTag:false}),'');
 assert.equal(parseSerialText('[SN 2Ts7T15 027 upi]'),'');
 assert.equal(parseSerialText('SN 2018/1195 VZ/ ur'),'');
 assert.equal(parseSerialText('LOT 12345678'),'');
});
test('serial has one spelling: spacing unified, digits and leading zeros untouched',()=>{
 for(const input of ['26168203001',' 26168203 001 ','26168203   001'])assert.equal(normalizeSerial(input),'26168203 001');
 assert.equal(normalizeSerial('001234 007'),'001234 007');
 assert.equal(normalizeSerial('0012340070'),'0012340070');
 assert.equal(normalizeSerial('ab12 c'),'AB12 C');
});
test('vote fills only on clear agreement',()=>{
 assert.equal(vote(['A','A','B','']).value,'A');
 assert.deepEqual(vote(['A','B']),{value:'',status:'conflict',candidates:['A','B'],votes:1,total:2});
 assert.equal(vote(['A']).status,'conflict');
 assert.equal(vote(['','']).status,'missing');
});
test('O/0 decided from glyph geometry only when clear, always flagged',()=>{
 // Widths/heights measured on samples/labels/alcon-clareon-toric-01.png (model plate at 80 px).
 const glyphs=[['C',40,54],['N',37,52],['W',60,53],['O',30,53],['T',37,53],['2',30,52]].map(([text,width,height])=>({text,width,height}));
 const narrow=resolveZeroOh(glyphs);
 assert.deepEqual(narrow,{value:'CNW0T2',resolved:1,unresolved:0});
 const round=resolveZeroOh(glyphs.map(g=>g.text==='O'?{...g,width:46}:g));
 assert.equal(round.value,'CNWOT2');
 const unclear=resolveZeroOh(glyphs.map(g=>g.text==='O'?{...g,width:39}:g));
 assert.deepEqual(unclear,{value:'CNWOT2',resolved:0,unresolved:1});
 // Broken boxes (wider than tall, or clipped height) are never decided.
 assert.equal(resolveZeroOh(glyphs.map(g=>g.text==='O'?{...g,width:170}:g)).unresolved,1);
 assert.equal(resolveZeroOh(glyphs.map(g=>g.text==='O'?{...g,width:10,height:25}:g)).unresolved,1);
 // A single clipped reference digit does not veto a clear 0.
 assert.equal(resolveZeroOh(glyphs.map(g=>g.text==='2'?{...g,width:9}:g)).value,'CNW0T2');
 assert.match(modelAmbiguity('CNW0T2',narrow),/по ширине знака/);
 assert.match(modelAmbiguity('CNWOT2',unclear),/O и 0/);
 assert.equal(modelAmbiguity('ABX42'),'');
});
test('model with unsettled O/0 is left empty and both spellings are offered',()=>{
 const voted={value:'CNWOT2',status:'ok',candidates:['CNWOT2','CNWOOT2']};
 const unclear=settleModel(voted,{value:'CNWOT2',resolved:0,unresolved:1});
 assert.equal(unclear.value,'');assert.equal(unclear.status,'conflict');
 assert.deepEqual(unclear.candidates.slice(0,2),['CNWOT2','CNW0T2']);
 assert.equal(settleModel(voted,null).value,'');
 assert.equal(settleModel(voted,{value:'CNW0T2',resolved:1,unresolved:0}).value,'CNW0T2');
 assert.equal(settleModel({value:'PXYWT3',status:'ok',candidates:['PXYWT3']},null).value,'PXYWT3');
});
test('clinic date crosses UTC midnight and handles another zone',()=>{
 assert.equal(clinicDate('2026-11-18T22:30:00Z'),'19.11.2026');
 assert.equal(clinicDate('2026-11-18T22:30:00Z','America/New_York'),'18.11.2026');
});
test('real XLSX round trip has exactly four columns with date, numeric power, text serial',async()=>{
 const buffer=await createExcel([{scanned_at:'2026-11-18T22:30:00Z',model:'=1+1',power:-2.5,serial:'001234 007'}],'Europe/Moscow');
 assert.equal(Buffer.from(buffer).subarray(0,2).toString(),'PK');
 const book=new ExcelJS.Workbook();await book.xlsx.load(buffer);const sheet=book.worksheets[0];
 assert.equal(sheet.columnCount,4);assert.equal(sheet.rowCount,2);
 assert.equal(sheet.getCell('A2').value.toISOString(),'2026-11-19T00:00:00.000Z');
 assert.equal(sheet.getCell('B2').value,'=1+1');assert.equal(sheet.getCell('B2').type,ExcelJS.ValueType.String);
 assert.equal(sheet.getCell('C2').value,-2.5);assert.equal(sheet.getCell('C2').type,ExcelJS.ValueType.Number);
 assert.equal(sheet.getCell('D2').value,'001234 007');assert.equal(sheet.getCell('D2').type,ExcelJS.ValueType.String);
});
test('download link is bound to session and owner, expires, and resists tampering',()=>{
 const key=downloadKey({TELEGRAM_BOT_TOKEN:'bot-token'}),now=Date.UTC(2026,10,19,12);
 const subject={sessionId:'12345678-1234-1234-1234-123456789012',owner:'42'};
 const token=createDownloadToken(subject,key,now);
 assert.match(token,/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
 assert.deepEqual(verifyDownloadToken(token,key,now+1000),subject);
 assert.throws(()=>verifyDownloadToken(token,key,now+(DOWNLOAD_TTL_SECONDS+1)*1000),/устарела/);
 assert.throws(()=>verifyDownloadToken(token,downloadKey({TELEGRAM_BOT_TOKEN:'other'}),now));
 const [payload,signature]=token.split('.');
 const forged=Buffer.from(JSON.stringify({s:subject.sessionId,o:'43',e:Math.floor(now/1000)+300})).toString('base64url');
 assert.throws(()=>verifyDownloadToken(`${forged}.${signature}`,key,now));
 for(const bad of ['',payload,`${token}.x`,'a.b'])assert.throws(()=>verifyDownloadToken(bad,key,now));
 assert.notDeepEqual(downloadKey({DOWNLOAD_SECRET:'s',TELEGRAM_BOT_TOKEN:'bot-token'}),key);
 assert.throws(()=>downloadKey({}));
});
function signed(params,token){const data=Object.entries(params).sort(([a],[b])=>a<b?-1:1).map(([k,v])=>`${k}=${v}`).join('\n');const key=createHmac('sha256','WebAppData').update(token).digest();return new URLSearchParams({...params,hash:createHmac('sha256',key).update(data).digest('hex')}).toString();}
test('Telegram signature, allowlist, freshness and tampering checks',()=>{
 const now=Date.now();const token='test-token';const auth_date=String(Math.floor(now/1000));
 const raw=signed({auth_date,user:JSON.stringify({id:42,username:'Ivan_Petrov'})},token);
 const allowed=parseAllowedUsernames(' @ivan_petrov , @Other_User,bad name,@x ');
 assert.deepEqual(allowed,['ivan_petrov','other_user']);
 // owner stays the numeric ID; username match is case-insensitive
 assert.equal(validateTelegram(raw,token,allowed,now),'42');
 assert.throws(()=>validateTelegram(raw,token,['other_user'],now),/Нет доступа/);
 assert.throws(()=>validateTelegram(raw,token,[],now),/Нет доступа/);
 const noName=signed({auth_date,user:JSON.stringify({id:42})},token);
 assert.throws(()=>validateTelegram(noName,token,allowed,now),/никнейм/);
 assert.throws(()=>validateTelegram(raw,'wrong',allowed,now));
 assert.throws(()=>validateTelegram(raw,token,allowed,now+86401000));
 assert.throws(()=>validateTelegram(raw+'&user=%7B%22id%22%3A43%2C%22username%22%3A%22other_user%22%7D',token,allowed,now));
 assert.throws(()=>validateTelegram('',token,allowed,now));
});

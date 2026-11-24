import express from 'express';
import rateLimit from 'express-rate-limit';
import { createClient } from '@supabase/supabase-js';
import { validateTelegram, parseAllowedUsernames } from './auth.js';
import { createExcel } from './excel.js';
import { missingCustomerFields, readCustomer } from './customer.js';
import { createDownloadToken, downloadKey, verifyDownloadToken } from './download.js';
import { normalizeSerial, parsePower } from '../shared/label.js';
const app = express();
const zone = process.env.CLINIC_TIMEZONE || 'Europe/Moscow';
new Intl.DateTimeFormat('ru-RU',{timeZone:zone});
const customer = readCustomer();
const missingCustomer = missingCustomerFields();
if (missingCustomer.length) console.warn('Excel header will be incomplete, not set:', missingCustomer.join(', '));
const db = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY ? createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}}) : null;
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
app.disable('x-powered-by');
// On Railway the app sits behind one proxy: it must listen on all interfaces, and the client IP
// (for rate limiting) comes from X-Forwarded-For. Locally it stays on loopback only.
const onRailway = Boolean(process.env.RAILWAY_ENVIRONMENT_NAME);
if (onRailway) app.set('trust proxy', 1);
app.use(express.json({limit:'16kb'}));
app.use('/api',rateLimit({windowMs:60000,limit:120}));
// Telegram's native downloader fetches this URL itself, without the init-data header:
// the signed short-lived token in the path is the authorization. Must stay above the auth middleware.
app.get('/api/download/:token',async(req,res)=>{
 if (!db) return res.status(503).json({error:'Supabase ещё не настроен'});
 let subject;
 try { subject=verifyDownloadToken(req.params.token,downloadKey()); } catch(e) { return res.status(403).json({error:e.message}); }
 const session=check(await db.from('rescan_sessions').select('*').eq('id',subject.sessionId).eq('owner_id',subject.owner).maybeSingle());
 if(!session||!session.completed_at)return res.status(404).json({error:'Сессия не найдена или не завершена'});
 sendExcel(res,session,await createExcel(await getRows(session.id),customer));
});
app.use('/api',(req,res,next) => {
 res.set('Cache-Control','no-store');
 if (!db) return res.status(503).json({error:'Supabase ещё не настроен. Укажите серверные переменные окружения и примените миграцию.'});
 try {
  req.owner = process.env.DEV_AUTH === 'true' && process.env.NODE_ENV !== 'production' && ['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress) ? 'local-developer' : validateTelegram(req.get('X-Telegram-Init-Data') || '',process.env.TELEGRAM_BOT_TOKEN || '',parseAllowedUsernames(process.env.ALLOWED_TELEGRAM_USERNAMES));
  next();
 } catch(e) {res.status(401).json({error:e.message});}
});
function check(result) { if (result.error) { console.error('Supabase error', result.error.code, result.error.message); const error = new Error(result.error.code === '23505' ? 'Этот серийный номер уже добавлен в сессию' : 'Не удалось сохранить или получить данные. Повторите попытку.'); error.status=409; throw error; } return result.data; }
app.get('/api/sessions',async(req,res)=>res.json({timeZone:zone,sessions:check(await db.from('rescan_sessions').select('*').eq('owner_id',req.owner).order('created_at',{ascending:false}).limit(100))}));
app.post('/api/sessions',async(req,res)=>{
 if(!uuid(req.body.id)) return res.status(400).json({error:'Некорректный ID'});
 const existing = check(await db.from('rescan_sessions').select('*').eq('id',req.body.id).eq('owner_id',req.owner).maybeSingle());
 res.json(existing || check(await db.from('rescan_sessions').insert({id:req.body.id,owner_id:req.owner}).select().single()));
});
app.use('/api/sessions/:id',async(req,res,next)=>{
 if(!uuid(req.params.id)) return res.status(400).json({error:'Некорректная сессия'});
 req.scanSession=check(await db.from('rescan_sessions').select('*').eq('id',req.params.id).eq('owner_id',req.owner).maybeSingle());
 if(!req.scanSession) return res.status(404).json({error:'Сессия не найдена'});
 next();
});
async function getRows(id) {
 const rows=[];
 for(let from=0;;from+=1000){const batch=check(await db.from('rescan_lenses').select('*').eq('session_id',id).order('scanned_at').order('id').range(from,from+999));rows.push(...batch);if(batch.length<1000)return rows;}
}
app.get('/api/sessions/:id',async(req,res)=>res.json({session:req.scanSession,rows:await getRows(req.scanSession.id)}));
app.post('/api/sessions/:id/lenses',async(req,res)=>{
 const {id,model,serial}=req.body;
 if(!uuid(id)||typeof model!=='string'||!model.trim()||model.length>80||typeof serial!=='string'||!serial.trim()||serial.length>100) return res.status(400).json({error:'Заполните модель, силу и серийный номер'});
 let power;try{power=parsePower(req.body.power);}catch(e){return res.status(400).json({error:e.message});}
 const result=check(await db.rpc('rescan_add_lens',{p_owner:req.owner,p_session:req.scanSession.id,p_id:id,p_model:model.trim(),p_power:power,p_serial:normalizeSerial(serial)}));
 res.json(Array.isArray(result)?result[0]:result);
});
app.post('/api/sessions/:id/complete',async(req,res)=>{
 if(!(await getRows(req.scanSession.id)).length)return res.status(400).json({error:'Сначала добавьте хотя бы одну линзу'});
 // UPDATE берёт ту же блокировку строки, что и rescan_add_lens.
 check(await db.from('rescan_sessions').update({completed_at:new Date().toISOString()}).eq('id',req.scanSession.id).eq('owner_id',req.owner).is('completed_at',null));
 res.json({ok:true});
});
const XLSX_TYPE='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const excelName=session=>`rescan-${session.id.slice(0,8)}.xlsx`;
function sendExcel(res,session,buffer){
 // Telegram Web downloads cross-origin; the docs require this origin to be allowed.
 res.set({'Content-Type':XLSX_TYPE,'Content-Disposition':`attachment; filename="${excelName(session)}"`,'Access-Control-Allow-Origin':'https://web.telegram.org'}).send(Buffer.from(buffer));
}
function requireCompleted(req,res){
 if(req.scanSession.completed_at)return true;
 res.status(409).json({error:'Сначала завершите сессию'});
 return false;
}
app.get('/api/sessions/:id/excel',async(req,res)=>{
 if(!requireCompleted(req,res))return;
 sendExcel(res,req.scanSession,await createExcel(await getRows(req.scanSession.id),customer));
});
// Link for WebApp.downloadFile: the client adds its own origin, Telegram then fetches /api/download/<token>.
app.post('/api/sessions/:id/excel-link',(req,res)=>{
 if(!requireCompleted(req,res))return;
 let key;
 try { key=downloadKey(); } catch(e) { console.error(e.message); return res.status(503).json({error:'Скачивание не настроено на сервере'}); }
 res.json({path:`/api/download/${createDownloadToken({sessionId:req.scanSession.id,owner:req.owner},key)}`,fileName:excelName(req.scanSession)});
});
// Works on any Telegram version: the bot sends the file into the employee's chat with it.
app.post('/api/sessions/:id/excel-to-chat',async(req,res)=>{
 if(!requireCompleted(req,res))return;
 if(!/^\d+$/.test(req.owner))return res.status(400).json({error:'Отправка в чат доступна только при входе из Telegram'});
 const buffer=await createExcel(await getRows(req.scanSession.id),customer);
 const form=new FormData();
 form.append('chat_id',req.owner);
 form.append('caption',`ReScan · сессия № ${req.scanSession.id.slice(0,8)}`);
 form.append('document',new Blob([buffer],{type:XLSX_TYPE}),excelName(req.scanSession));
 const sent=await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendDocument`,{method:'POST',body:form}).then(r=>r.json()).catch(()=>({ok:false,description:'network'}));
 if(!sent.ok){console.error('sendDocument failed',sent.error_code,sent.description);return res.status(502).json({error:'Не удалось отправить файл в чат. Откройте чат с ботом, нажмите «Старт» и повторите'});}
 res.json({ok:true});
});
app.use('/api',(req,res)=>res.status(404).json({error:'Неизвестный запрос'}));
app.use(express.static('dist'));
app.get('/{*path}',(req,res)=>res.sendFile('index.html',{root:'dist'}));
app.use((err,req,res,next)=>{console.error(err.message);res.status(err.status||500).json({error:err.status ? err.message : 'Ошибка сервера. Повторите попытку.'});});
app.listen(process.env.PORT||3001,process.env.HOST||(onRailway?'0.0.0.0':'127.0.0.1'),()=>console.log('ReScan API ready'));

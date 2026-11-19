import ExcelJS from 'exceljs';
import { clinicDate } from '../shared/label.js';
export async function createExcel(rows, zone) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Линзы');
  sheet.columns = [{header:'Дата сканирования',key:'date',width:23},{header:'Модель линзы',key:'model',width:24},{header:'Оптическая сила, D',key:'power',width:25},{header:'Серийный номер',key:'serial',width:30}];
  for (const row of rows) {
    const [day, month, year] = clinicDate(row.scanned_at, zone).split('.').map(Number);
    sheet.addRow({ date: new Date(Date.UTC(year,month-1,day)), model:String(row.model), power:Number(row.power), serial:String(row.serial) });
  }
  sheet.getColumn(1).numFmt = 'dd.mm.yyyy';
  sheet.getColumn(3).numFmt = '+0.###;-0.###;0';
  sheet.getColumn(4).numFmt = '@';
  sheet.getRow(1).font = {bold:true,color:{argb:'FFFFFFFF'}};
  sheet.getRow(1).fill = {type:'pattern',pattern:'solid',fgColor:{argb:'FF102B39'}};
  sheet.views = [{state:'frozen',ySplit:1}];
  sheet.autoFilter = 'A1:D1';
  return workbook.xlsx.writeBuffer();
}

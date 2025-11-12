// utils/pdfGenerator.js
import PDFDocument from 'pdfkit';
import { fileURLToPath } from 'node:url';
import path from "path";
import fs from 'fs';
import os from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function gerarPDF(dadosUsuario, relatorio) {
  const doc = new PDFDocument({ margin: 50 });

  const logoPath = path.resolve(__dirname, '../images/logo.png');
  const nomeBruto = String(dadosUsuario?.nome ?? 'usuario');
  const nomeArquivo = `Relatório-${nomeBruto.replace(/\s+/g, '_')}.pdf`;

  const pastaDownloads = path.join(os.homedir(), 'Downloads');
  if (!fs.existsSync(pastaDownloads)) {
    fs.mkdirSync(pastaDownloads, { recursive: true });
  }

  const caminho = path.join(pastaDownloads, nomeArquivo);
  doc.pipe(fs.createWriteStream(caminho));

  const logoWidth = 60;
  const logoHeight = 60;
  const marginX = 90;
  const startY = doc.y;

  doc.image(logoPath, marginX, startY, { width: logoWidth, height: logoHeight });

  doc.fontSize(20).font('Times-Bold').text("Relatório de Saúde Gerado pela ", { align: "center" });
  doc.fontSize(20).font('Times-Bold').text("MindTracking", { align: "center" }).moveDown(2);

  doc.fontSize(12).font('Times-Roman')
    .text(`Nome: ${dadosUsuario?.nome ?? 'Sem nome'}`)
    .text(`E-mail: ${dadosUsuario?.email ?? 'Sem e-mail'}`)
    .text(`Data de Nascimento: ${formatarData(dadosUsuario?.nascimento) ?? 'Sem data'}`)
    .moveDown(1.5);

  doc.fontSize(16).font('Courier').text("Relatório", { align: 'center' }).moveDown();

  // 🗒️ Diários
  doc.fontSize(14).font('Times-Roman').text("Diários").moveDown(0.5);
  if (Array.isArray(relatorio?.diarios) && relatorio.diarios.length > 0) {
    relatorio.diarios.forEach((diario, index) => {
      doc.fontSize(12).text(`Diário ${index + 1} - ${formatarData(diario.data)}:`, { continued: false });
      const conteudo = diario.conteudo || JSON.stringify(diario);
      doc.fontSize(12).text(conteudo, { indent: 20, align: 'justify' });
      doc.moveDown(0.5);
    });
  } else {
    doc.fontSize(12).text("Nenhum diário registrado.", { indent: 20 });
  }

  doc.moveDown();

  // 🧩 Diagnósticos
  doc.fontSize(14).text("Diagnósticos").moveDown(0.5);
  if (Array.isArray(relatorio?.diagnosticos) && relatorio.diagnosticos.length > 0) {
    relatorio.diagnosticos.forEach((diagnostico, index) => {
      doc.fontSize(12).text(`${diagnostico}`, { indent: 20 });
    });
  } else {
    doc.fontSize(12).text("Sem diagnósticos registrados.", { indent: 20 });
  }

  doc.moveDown();

  // 📋 Questionários
  doc.fontSize(14).fillColor('black').text('Questionários Respondidos', { align: 'center' }).moveDown(0.5);

  if (Array.isArray(relatorio?.questionarios) && relatorio.questionarios.length > 0) {
    const colWidths = [120, 180, 150];
    const rowHeight = 24;
    const zebra1 = '#F3F4F6';
    const zebra2 = '#E0E7EF';
    const totalWidth = colWidths.reduce((a, b) => a + b);
    const startX = (doc.page.width - totalWidth) / 2;
    let startY = doc.y;
    const margemInferior = doc.page.height - 50;
    let cabecalhoJaDesenhado = false;
    const medias = [];

    relatorio.questionarios.forEach((questionario, index) => {
      if (!cabecalhoJaDesenhado) {
        doc.rect(startX, startY, colWidths[0], rowHeight).fill('#051885');
        doc.rect(startX + colWidths[0], startY, colWidths[1], rowHeight).fill('#051885');
        doc.rect(startX + colWidths[0] + colWidths[1], startY, colWidths[2], rowHeight).fill('#051885');
        doc.font('Times-Bold').fontSize(12).fillColor('white')
          .text('Nº', startX, startY + 6, { width: colWidths[0], align: 'center' })
          .text('Data', startX + colWidths[0], startY + 6, { width: colWidths[1], align: 'center' })
          .text('Nota Média', startX + colWidths[0] + colWidths[1], startY + 6, { width: colWidths[2], align: 'center' });
        doc.lineWidth(1).strokeColor('black')
          .rect(startX, startY, totalWidth, rowHeight).stroke();
        startY += rowHeight;
        cabecalhoJaDesenhado = true;
      }

      if (startY + rowHeight > margemInferior) {
        doc.addPage();
        startY = 50;
      }

      const media = calcularMediaQuestionario(questionario);
      medias.push(media);
      const zebra = index % 2 === 0 ? zebra1 : zebra2;

      doc.rect(startX, startY, totalWidth, rowHeight).fill(zebra);
      doc.font('Times-Roman').fillColor('black')
        .text(`#${index + 1}`, startX, startY + 7, { width: colWidths[0], align: 'center' })
        .text(formatarData(questionario.data), startX + colWidths[0], startY + 7, { width: colWidths[1], align: 'center' })
        .text(`${media.toFixed(1)}/10`, startX + colWidths[0] + colWidths[1], startY + 7, { width: colWidths[2], align: 'center' });

      let lineX = startX;
      colWidths.forEach(width => {
        doc.rect(lineX, startY, width, rowHeight).stroke('black');
        lineX += width;
      });
      startY += rowHeight;
    });

    if (medias.length > 0) {
      startY += 10;
      if (startY + 20 > margemInferior) {
        doc.addPage();
        startY = 50;
      }
      doc.font('Times-Roman').fontSize(13).fillColor('#051885')
        .text(`Média Geral: ${(medias.reduce((a, b) => a + b, 0) / medias.length).toFixed(1)}/10`, startX, startY, { width: totalWidth, align: 'center' });
    }
  } else {
    doc.fontSize(12).fillColor('black').text('Nenhum questionário respondido.', { align: 'center' });
  }

  doc.end();
  return caminho;
}

function formatarData(data) {
  if (!data) return 'Data não informada';

  try {
    // Trata strings ISO (com ou sem fuso)
    let date;
    if (typeof data === 'string') {
      // Remove frações de segundo e garante formato válido
      const normalizada = data.split('.')[0];
      date = new Date(normalizada + (normalizada.endsWith('Z') ? '' : 'Z')); 
      // Adiciona "Z" se não houver timezone → assume UTC
    } else {
      date = new Date(data);
    }

    // Se a data ainda for inválida, retorna o valor original
    if (isNaN(date)) return String(data);

    // Formata no padrão brasileiro
    return date.toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
  } catch {
    return String(data);
  }
}


function calcularMediaQuestionario(questionario) {
  if (questionario.media !== undefined && questionario.media !== null) return Number(questionario.media);
  if (questionario.nota_convertida !== undefined && questionario.nota_convertida !== null) return Number(questionario.nota_convertida);
  return 0;
}

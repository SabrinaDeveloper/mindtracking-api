// pdfController.js - Versão Simplificada
import { relatorioUsuario } from '../services/pdf.js';
import { gerarPDF } from '../utils/pdfGenerator.js';

export async function gerarRelatorio(req, res) {
  try {
    const { id } = req.params;

    const dados = await relatorioUsuario(id);
    
    if (!dados) {
      return res.status(404).json({ message: "Paciente não encontrado" });
    }

    const { dadosUsuario, relatorio } = dados;
    
    

    // Gerar PDF
    const caminhoPDF = gerarPDF(dadosUsuario, relatorio);

    // Configurar resposta para download
    const nomeArquivo = `Relatorio-${dadosUsuario.nome || 'Usuario'}.pdf`;
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${nomeArquivo}"`);

    // Enviar arquivo
    return res.download(caminhoPDF, nomeArquivo, (err) => {
      if (err) {
        console.error('❌ Erro no download:', err);
        // Tentar fallback: enviar como JSON com caminho
        return res.json({ 
          success: false, 
          message: 'Erro no download, arquivo gerado em:', 
          caminho: caminhoPDF 
        });
      }
    });

  } catch (err) {
    console.error("❌ ERRO NO CONTROLLER:", err);
    return res.status(500).json({ 
      success: false, 
      message: "Erro interno do servidor",
      ...(process.env.NODE_ENV === 'development' && { error: err.message })
    });
  }
}

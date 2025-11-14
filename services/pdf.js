// services/pdf.js
import pool from '../config/database.js';

export async function relatorioUsuario(id) {
  const query = "SELECT * FROM relatorio_usuario($1)";
  const result = await pool.query(query, [id]);

  console.log("🔍 Result do banco:", JSON.stringify(result.rows, null, 2));

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];

  const dadosUsuario = {
    nome: row.usuario_nome,
    email: row.usuario_email,
    nascimento: row.usuario_data_nascimento,
  };

  const diariosProcessados = processarDiarios(row.diarios);
  const questionariosProcessados = processarQuestionarios(row.questionarios);
  const diagnosticosProcessados = processarDiagnosticos(row.diagnosticos);

  return {
    dadosUsuario,
    relatorio: {
      diarios: diariosProcessados,
      questionarios: questionariosProcessados,
      diagnosticos: diagnosticosProcessados
    }
  };
}

// 🗒️ Diários
function processarDiarios(diarios) {
  if (!Array.isArray(diarios) || diarios.length === 0) return [];

  return diarios.map((diario, index) => {
    if (typeof diario === 'object' && diario !== null) {
      const dataDiario = diario.data_hora || 'Data não disponível';
      return {
        id: diario.id || index + 1,
        data: dataDiario,
        conteudo: diario.texto || diario.conteudo || diario.descricao || JSON.stringify(diario)
      };
    }

    if (typeof diario === 'string') {
      try {
        const diarioParsed = JSON.parse(diario);
        const dataDiario = diarioParsed.data_hora || 'Data não disponível';
        return {
          id: index + 1,
          data: dataDiario,
          conteudo: diarioParsed.texto || diarioParsed.conteudo || diario
        };
      } catch {
        return {
          id: index + 1,
          data: 'Data não disponível',
          conteudo: diario
        };
      }
    }

    return {
      id: index + 1,
      data: 'Data não disponível',
      conteudo: String(diario)
    };
  });
}

// 📋 Questionários
function processarQuestionarios(questionarios) {
  if (!Array.isArray(questionarios) || questionarios.length === 0) return [];

  return questionarios.map((q, index) => {
    let questObj = q;
    if (typeof q === 'string') {
      try {
        questObj = JSON.parse(q);
      } catch {
        questObj = { texto: q };
      }
    }

    return {
      id: questObj.questionario_id || questObj.id || index + 1,
      data: formatarData(questObj.data),
      pontuacao: Number(questObj.pontuacao ?? 0),
      nota_convertida: Number(questObj.nota_convertida ?? 0),
      texto: questObj.texto || ''
    };
  });
}

// 🧩 Diagnósticos
function processarDiagnosticos(diagnosticos) {
  if (!Array.isArray(diagnosticos) || diagnosticos.length === 0) return [];

  return diagnosticos.map((diagnostico) => {
    if (typeof diagnostico === 'object' && diagnostico !== null) {
      return diagnostico.descricao || diagnostico.texto || diagnostico.diagnostico || JSON.stringify(diagnostico);
    }
    return String(diagnostico);
  });
}

function formatarData(data) {
  if (!data) return '-';

  try {
    // Se vier como objeto Date
    if (data instanceof Date) {
      const dia = String(data.getDate()).padStart(2, '0');
      const mes = String(data.getMonth() + 1).padStart(2, '0');
      const ano = data.getFullYear();
      return `${dia}/${mes}/${ano}`;
    }

    // Se vier como string no formato ISO (ex: "2025-11-12T00:00:00")
    if (typeof data === 'string') {
      const match = data.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (match) {
        const [, ano, mes, dia] = match;
        return `${dia}/${mes}/${ano}`;
      }
    }

    // Caso nada funcione, devolve como texto mesmo
    return String(data);
  } catch (err) {
    console.error('Erro ao formatar data:', err);
    return String(data);
  }
}


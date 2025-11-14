// Importa o pacote bcrypt para criptografar senhas
import bcrypt from 'bcrypt';
// Importa o pacote jsonwebtoken para gerar e verificar tokens JWT
import jwt from 'jsonwebtoken';
// Importa a configuração do banco de dados
import banco from '../config/database.js';
import transporter from '../config/emailConfig.js';
import dotenv from 'dotenv';
import { emailTemplates } from '../templates/emailTemplates.js';
dotenv.config();
// Chave secreta usada para assinar os tokens JWT
const SECRET_KEY = process.env.JWT_KEY;

// Função para registrar um novo usuário
// Gera um código de verificação de 4 dígitos
function gerarCodigoVerificacao() {
    return Math.floor(1000 + Math.random() * 9000).toString();
}

// Função para registrar um novo usuário
export async function register(req, res) {
    const { nome, email, senha, confirmarSenha, data_nascimento, telefone, genero } = req.body;

    // Verificação de campos obrigatórios
    if (!nome || !email || !senha || !confirmarSenha || !data_nascimento || !telefone || !genero) {
        return res.status(400).json({ 
            success: false, 
            message: 'Todos os campos são obrigatórios para o registro' 
        });
    }

    // Validação de senha
    if (senha !== confirmarSenha) {
        return res.status(400).json({ 
            success: false, 
            message: 'As senhas não coincidem. Por favor, verifique e tente novamente.' 
        });
    }
    // Validação de telefone
    if (telefone.length > 15) {
        return res.status(400).json({
            success: false,
            message: 'O telefone deve conter no máximo 15 caracteres.'
        });
    }
    // Validação de gênero
    if (genero.trim() === '') {
        return res.status(400).json({
            success: false,
            message: 'O campo gênero não pode estar vazio.'
        });
    }

    try {
        const { rows } = await banco.query('SELECT * FROM usuarios WHERE email = $1', [email]);
        if (rows.length > 0) {
            return res.status(400).json({ 
                success: false, 
                message: 'Este e-mail já está cadastrado em nossa plataforma. Por favor, utilize outro e-mail ou faça login.' 
            });
        }

        const salt = await bcrypt.genSalt(10);
        const senhaCriptografada = await bcrypt.hash(senha, salt);

        const codigoVerificacao = gerarCodigoVerificacao();

        try {
            await transporter.sendMail({
                from: `"MindTracking" <${process.env.EMAIL_USER}>`,
                to: email,
                subject: 'Código de Verificação - MindTracking',
                html: emailTemplates.verificationCode(codigoVerificacao),
                text: `Seu código de verificação é: ${codigoVerificacao} use-o para verificar seu e-mail. Se você não solicitou este código, ignore este e-mail. Atenciosamente, Equipe MindTracking.`
            });
        } catch (emailError) {
            console.error('Erro ao enviar e-mail:', emailError);
            return res.status(500).json({
                success: false,
                message: 'Não foi possível enviar o e-mail de verificação. Por favor, tente novamente mais tarde.'
            });
        }

        const novoUsuario = await banco.query(
            'INSERT INTO usuarios (nome, email, senha, data_nascimento, telefone, genero, questionario_inicial, email_verificado, codigo_verificacao) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id, nome, email, data_nascimento, telefone, genero, questionario_inicial',
            [nome, email, senhaCriptografada, data_nascimento, telefone, genero, false, false, codigoVerificacao]
        );

        const user = novoUsuario.rows[0];

        return res.status(201).json({
            success: true,
            message: 'Código de verificação enviado para o e-mail. Verifique sua caixa de entrada para concluir o registro.',
            user: {
                id: user.id,
                nome: user.nome,
                email: user.email,
                data_nascimento: user.data_nascimento,
                telefone: user.telefone,
                genero: user.genero,
                questionario_inicial: user.questionario_inicial
            }
        });

    } catch (error) {
        console.error('Erro no registro:', error);
        if (error.code === '23505') { // Violação de chave única
            return res.status(400).json({
                success: false,
                message: 'Este e-mail já está cadastrado em nossa plataforma.'
            });
        }
        return res.status(500).json({
            success: false,
            message: 'Ocorreu um erro ao criar sua conta. Por favor, tente novamente mais tarde.',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
}

// Função para verificar o código de e-mail
export async function verifyEmail(req, res) {
    const { email, codigo } = req.body;

    if (!email || !codigo) {
        return res.status(400).json({
            success: false,
            message: 'E-mail e código de verificação são obrigatórios'
        });
    }

    try {
        const { rows } = await banco.query('SELECT * FROM usuarios WHERE email = $1', [email]);
        if (rows.length === 0) {
            return res.status(404).json({ 
                success: false, 
                message: 'Usuário não encontrado. Verifique se o e-mail está correto.' 
            });
        }

        const user = rows[0];
        if (user.email_verificado) {
            return res.status(400).json({ 
                success: false, 
                message: 'Este e-mail já foi verificado anteriormente. Você pode prosseguir com o login.' 
            });
        }

        if (user.codigo_verificacao !== codigo) {
            const tentativas = (user.tentativas_recuperacao || 0) + 1;

            if (tentativas >= 3) {
                // gera novo código e zera tentativas
                const novoCodigo = gerarCodigoVerificacao();
                await banco.query(
                    'UPDATE usuarios SET codigo_verificacao = $1, tentativas_recuperacao = 0 WHERE email = $2',
                    [novoCodigo, email]
                );

                try {
                    await transporter.sendMail({
                        from: `"MindTracking" <${process.env.EMAIL_USER}>`,
                        to: email,
                        subject: 'Novo Código de Verificação - MindTracking',
                        html: emailTemplates.verificationCode(novoCodigo),
                        text: `Seu novo código de verificação é: ${novoCodigo}. Você tem 3 novas tentativas para utilizá-lo.`
                    });
                } catch (emailError) {
                    console.error('Erro ao enviar novo código:', emailError);
                }

                return res.status(400).json({
                    success: false,
                    message: 'Número máximo de tentativas excedido. Um novo código foi enviado para o seu e-mail.'
                });
            }

            await banco.query(
                'UPDATE usuarios SET tentativas_recuperacao = $1 WHERE email = $2',
                [tentativas, email]
            );

            return res.status(400).json({ 
                success: false, 
                message: `Código inválido. Você ainda tem ${3 - tentativas} tentativa(s) restante(s).` 
            });
        }

        // código válido -> confirma verificação
        await banco.query(
            'UPDATE usuarios SET email_verificado = true, codigo_verificacao = null, tentativas_recuperacao = 0 WHERE email = $1',
            [email]
        );

        const token = jwt.sign({ id: user.id, email: user.email }, SECRET_KEY, { expiresIn: '1h' });

        return res.status(200).json({
            success: true,
            message: 'E-mail verificado com sucesso! Você já pode acessar sua conta.',
            token,
            user: {
                id: user.id,
                nome: user.nome,
                email: user.email,
                questionario_inicial: user.questionario_inicial
            }
        });

    } catch (error) {
        console.error('Erro ao verificar e-mail:', error);
        return res.status(500).json({
            success: false,
            message: 'Ocorreu um erro ao verificar seu e-mail. Por favor, tente novamente mais tarde.',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
}

// Função para realizar o login de um usuário
export async function login(req, res) {
    const { email, senha } = req.body;

    if (!email || !senha) {
        return res.status(400).json({
            success: false,
            message: 'E-mail e senha são obrigatórios para realizar o login'
        });
    }

    try {
        const { rows } = await banco.query('SELECT * FROM usuarios WHERE email = $1', [email]);
        if (rows.length === 0) {
            return res.status(400).json({ 
                success: false, 
                message: 'E-mail não encontrado. Verifique se o e-mail está correto ou crie uma nova conta.' 
            });
        }

        const user = rows[0];

        // Verificar senha primeiro
        const senhaCorreta = await bcrypt.compare(senha, user.senha); 
        if (!senhaCorreta) {
            return res.status(400).json({ 
                success: false, 
                message: 'Senha incorreta. Por favor, verifique sua senha e tente novamente.' 
            });
        }

        // Se senha correta mas e-mail não verificado -> enviar código
        if (!user.email_verificado) {
            const novoCodigo = gerarCodigoVerificacao();

            try {
                await banco.query(
                    'UPDATE usuarios SET codigo_verificacao = $1 WHERE email = $2',
                    [novoCodigo, email]
                );

                await transporter.sendMail({
                    from: `"MindTracking" <${process.env.EMAIL_USER}>`,
                    to: email,
                    subject: 'Novo Código de Verificação - MindTracking',
                    html: emailTemplates.verificationCode(novoCodigo),
                    text: `Seu novo código de verificação é: ${novoCodigo} use-o para verificar seu e-mail. Se você não solicitou este código, ignore este e-mail. Atenciosamente, Equipe MindTracking.`
                });

                return res.status(200).json({
                    success: false,
                    needsVerification: true,
                    email: email,
                    email_verificado: false,
                    message: 'Por favor, verifique seu e-mail antes de fazer login. Um novo código de verificação foi enviado para seu e-mail.'
                });
            } catch (emailError) {
                console.error('Erro ao enviar e-mail:', emailError);
                return res.status(500).json({
                    success: false,
                    message: 'Não foi possível enviar o novo código de verificação. Por favor, tente novamente mais tarde.'
                });
            }
        }

        // Se e-mail já verificado -> login normal
        const token = jwt.sign({ id: user.id, email: user.email }, SECRET_KEY, { expiresIn: '1h' });

        return res.status(200).json({
            success: true,
            message: 'Login realizado com sucesso! Bem-vindo(a) de volta.',
            user: {
                id: user.id,
                nome: user.nome,
                email: user.email,
                questionario_inicial: user.questionario_inicial,
                email_verificado: user.email_verificado,
                foto_perfil_url: user.foto_perfil_url ?? null,
                foto_fundo_url: user.foto_fundo_url ?? null
            },
            token,
        });

    } catch (error) {
        console.error('Erro no login:', error);
        return res.status(500).json({ 
            success: false, 
            message: 'Ocorreu um erro ao realizar o login. Por favor, tente novamente mais tarde.',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
}

export async function enviarCodigoRecuperacao(req, res) {
    const { email } = req.body;

    if (!email) {
        return res.status(400).json({
            success: false,
            message: 'O e-mail é obrigatório para enviar o código de recuperação'
        });
    }

    try {
        const { rows } = await banco.query('SELECT * FROM usuarios WHERE email = $1', [email]);
        if (rows.length === 0) {
            return res.status(404).json({ 
                success: false, 
                message: 'E-mail não encontrado. Verifique se o e-mail está correto.' 
            });
        }

        const codigo = gerarCodigoVerificacao();
        
        try {
            await banco.query('UPDATE usuarios SET codigo_recuperacao = $1, tentativas_recuperacao = 0 WHERE email = $2', [codigo, email]);
            
            await transporter.sendMail({
                from: `"MindTracking" <${process.env.EMAIL_USER}>`,
                to: email,
                subject: 'Código de Recuperação de Senha - MindTracking',
                html: emailTemplates.passwordRecovery(codigo),
                text: `Seu código de recuperação é: ${codigo}. Use este código para redefinir sua senha. Se você não solicitou esta recuperação, ignore este e-mail.`
            });

            return res.status(200).json({ 
                success: true, 
                message: 'Código de recuperação enviado com sucesso para seu e-mail.' 
            });
        } catch (emailError) {
            console.error('Erro ao enviar e-mail:', emailError);
            return res.status(500).json({
                success: false,
                message: 'Não foi possível enviar o e-mail de recuperação. Por favor, tente novamente mais tarde.'
            });
        }
    } catch (error) {
        console.error('Erro ao processar recuperação:', error);
        return res.status(500).json({ 
            success: false, 
            message: 'Ocorreu um erro ao processar sua solicitação. Por favor, tente novamente mais tarde.',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
}

export async function verificarCodigoRecuperacao(req, res) {
    const { email, codigo } = req.body;

    if (!email || !codigo) {
        return res.status(400).json({
            success: false,
            message: 'E-mail e código de recuperação são obrigatórios'
        });
    }

    try {
        const { rows } = await banco.query('SELECT * FROM usuarios WHERE email = $1', [email]);
        if (rows.length === 0) {
            return res.status(404).json({ 
                success: false, 
                message: 'E-mail não encontrado. Verifique se o e-mail está correto.' 
            });
        }

        const user = rows[0];

        if (user.codigo_recuperacao !== codigo) {
            const tentativas = (user.tentativas_recuperacao || 0) + 1;

            if (tentativas >= 3) {
                // gera novo código e zera tentativas
                const novoCodigo = gerarCodigoVerificacao();
                await banco.query(
                    'UPDATE usuarios SET codigo_recuperacao = $1, tentativas_recuperacao = 0 WHERE email = $2',
                    [novoCodigo, email]
                );

                try {
                    await transporter.sendMail({
                        from: `"MindTracking" <${process.env.EMAIL_USER}>`,
                        to: email,
                        subject: 'Novo Código de Recuperação de Senha - MindTracking',
                        html: emailTemplates.passwordRecovery(novoCodigo),
                        text: `Seu novo código de recuperação é: ${novoCodigo}. Você tem 3 novas tentativas para utilizá-lo.`
                    });
                } catch (emailError) {
                    console.error('Erro ao enviar novo código:', emailError);
                }

                return res.status(400).json({ 
                    success: false, 
                    message: 'Número máximo de tentativas excedido. Um novo código foi enviado para o seu e-mail.' 
                });
            }

            await banco.query(
                'UPDATE usuarios SET tentativas_recuperacao = $1 WHERE email = $2',
                [tentativas, email]
            );

            return res.status(400).json({ 
                success: false, 
                message: `Código inválido. Você ainda tem ${3 - tentativas} tentativa(s) restante(s).` 
            });
        }

        // código válido -> resetar tentativas
        await banco.query('UPDATE usuarios SET tentativas_recuperacao = 0 WHERE email = $1', [email]);
        return res.status(200).json({ 
            success: true, 
            message: 'Código válido. Você pode prosseguir com a redefinição de senha.' 
        });

    } catch (error) {
        console.error('Erro ao verificar código:', error);
        return res.status(500).json({ 
            success: false, 
            message: 'Ocorreu um erro ao verificar o código. Por favor, tente novamente mais tarde.',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
}

export async function redefinirSenha(req, res) {
  const { email, senha, confirmarSenha } = req.body;

  if (!email || !senha || !confirmarSenha) {
    return res.status(400).json({
      success: false,
      message: 'Todos os campos são obrigatórios para redefinir a senha'
    });
  }

  if (senha !== confirmarSenha) {
    return res.status(400).json({
      success: false,
      message: 'As senhas não coincidem. Por favor, verifique e tente novamente.'
    });
  }

  try {
    // Verifica se o e-mail existe no banco
    const usuario = await banco.query(
      'SELECT id FROM usuarios WHERE email = $1',
      [email]
    );

    if (usuario.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Nenhum usuário encontrado com este e-mail.'
      });
    }

    // Criptografa e atualiza a senha
    const salt = await bcrypt.genSalt(10);
    const senhaCriptografada = await bcrypt.hash(senha, salt);

    await banco.query(
      'UPDATE usuarios SET senha = $1, codigo_recuperacao = null, tentativas_recuperacao = 0 WHERE email = $2',
      [senhaCriptografada, email]
    );

    return res.status(200).json({
      success: true,
      message: 'Senha redefinida com sucesso! Você já pode fazer login com sua nova senha.'
    });
  } catch (error) {
    console.error('Erro ao redefinir senha:', error);
    return res.status(500).json({
      success: false,
      message: 'Ocorreu um erro ao redefinir sua senha. Por favor, tente novamente mais tarde.',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}

export async function deleteAccount(req, res) {
    const userId = req.user?.id;
    if (!userId) {
        return res.status(401).json({ success: false, message: 'Usuário não autenticado.' });
    }
    try {
        // Exclui os diagnósticos do usuário
        await banco.query('DELETE FROM diagnosticos WHERE usuario_id = $1', [userId]);
        // Exclui as respostas do usuário
        await banco.query('DELETE FROM respostas WHERE usuario_id = $1', [userId]);
        // Exclui os questionários do usuário
        await banco.query('DELETE FROM questionarios WHERE usuario_id = $1', [userId]);
        // Exclui o usuário
        await banco.query('DELETE FROM usuarios WHERE id = $1', [userId]);
        return res.status(200).json({ success: true, message: 'Conta e todos os dados relacionados excluídos com sucesso.' });
    } catch (error) {
        console.error('Erro ao excluir conta:', error);
        return res.status(500).json({ success: false, message: 'Erro ao excluir conta. Tente novamente mais tarde.' });
    }
}

// Retorna o perfil do usuário (nome, email, idade, telefone, genero)
export async function getProfile(req, res) {
    const userId = req.user?.id;
    if (!userId) {
        return res.status(401).json({ success: false, message: 'Usuário não autenticado.' });
    }

    try {
        const { rows } = await banco.query(
            'SELECT id, nome, email, data_nascimento, telefone, genero, foto_perfil_url, foto_fundo_url FROM usuarios WHERE id = $1',
            [userId]
        );

        if (rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Usuário não encontrado.' });
        }

        const user = rows[0];
        let idade = null;
        if (user.data_nascimento) {
            const dataNascimento = new Date(user.data_nascimento);
            const hoje = new Date();
            idade = hoje.getFullYear() - dataNascimento.getFullYear();
            const mesAtual = hoje.getMonth();
            const mesNascimento = dataNascimento.getMonth();
            if (mesAtual < mesNascimento || (mesAtual === mesNascimento && hoje.getDate() < dataNascimento.getDate())) {
                idade--;
            }
        }

        return res.status(200).json({
            success: true,
            user: {
                id: user.id,
                nome: user.nome,
                email: user.email,
                data_nascimento: user.data_nascimento ?? null,
                idade: idade,
                telefone: user.telefone ?? null,
                genero: user.genero ?? null,
                foto_perfil_url: user.foto_perfil_url ?? null,
                foto_fundo_url: user.foto_fundo_url ?? null
            }
        });
    } catch (error) {
        console.error('Erro ao obter perfil do usuário:', error);
        return res.status(500).json({ success: false, message: 'Não foi possível obter o perfil neste momento.' });
    }
}

// Atualiza campos do perfil: nome, data_nascimento, telefone, genero (atualiza apenas campos fornecidos)
export async function updateProfile(req, res) {
    const userId = req.user?.id;
    if (!userId) {
        return res.status(401).json({ success: false, message: 'Usuário não autenticado.' });
    }

    const { nome, data_nascimento, telefone, genero, foto_perfil_url, foto_fundo_url } = req.body;

    // Validações dos campos já existentes
    if (nome !== undefined) {
        if (typeof nome !== 'string' || nome.trim() === '') {
            return res.status(400).json({ success: false, message: 'O campo nome não pode estar vazio.' });
        }
    }

    if (data_nascimento !== undefined) {
        const dt = new Date(data_nascimento);
        if (Number.isNaN(dt.getTime())) {
            return res.status(400).json({ success: false, message: 'Data de nascimento inválida. Use formato YYYY-MM-DD.' });
        }
        const hoje = new Date();
        if (dt > hoje) {
            return res.status(400).json({ success: false, message: 'Data de nascimento não pode ser no futuro.' });
        }
    }

    if (telefone !== undefined) {
        if (typeof telefone !== 'string' || telefone.trim() === '') {
            return res.status(400).json({ success: false, message: 'O campo telefone não pode estar vazio.' });
        }
        if (telefone.length > 15) {
            return res.status(400).json({ success: false, message: 'O telefone deve conter no máximo 15 caracteres.' });
        }
    }

    if (genero !== undefined) {
        if (typeof genero !== 'string' || genero.trim() === '') {
            return res.status(400).json({ success: false, message: 'O campo gênero não pode estar vazio.' });
        }
    }

    // Opcional: validações simples para as URLs das fotos (só se enviadas)
    if (foto_perfil_url !== undefined && typeof foto_perfil_url !== 'string') {
        return res.status(400).json({ success: false, message: 'URL de foto de perfil inválida.' });
    }
    if (foto_fundo_url !== undefined && typeof foto_fundo_url !== 'string') {
        return res.status(400).json({ success: false, message: 'URL de foto de fundo inválida.' });
    }

    try {
        // Monta dinamicamente a query de update para não sobrescrever campos não enviados
        const fields = [];
        const values = [];
        let idx = 1;

        if (nome !== undefined) { fields.push(`nome = $${idx++}`); values.push(nome); }
        if (data_nascimento !== undefined) { fields.push(`data_nascimento = $${idx++}`); values.push(data_nascimento); }
        if (telefone !== undefined) { fields.push(`telefone = $${idx++}`); values.push(telefone); }
        if (genero !== undefined) { fields.push(`genero = $${idx++}`); values.push(genero); }
        if (foto_perfil_url !== undefined) { fields.push(`foto_perfil_url = $${idx++}`); values.push(foto_perfil_url); }
        if (foto_fundo_url !== undefined) { fields.push(`foto_fundo_url = $${idx++}`); values.push(foto_fundo_url); }

        if (fields.length === 0) {
            return res.status(400).json({ success: false, message: 'Nenhum campo fornecido para atualização.' });
        }

        const query = `UPDATE usuarios SET ${fields.join(', ')} WHERE id = $${idx} RETURNING id, nome, email, data_nascimento, telefone, genero, foto_perfil_url, foto_fundo_url`;
        values.push(userId);

        const { rows } = await banco.query(query, values);
        const user = rows[0];

        let idade = null;
        if (user.data_nascimento) {
            const dataNascimento = new Date(user.data_nascimento);
            const hoje = new Date();
            idade = hoje.getFullYear() - dataNascimento.getFullYear();
            const mesAtual = hoje.getMonth();
            const mesNascimento = dataNascimento.getMonth();
            if (mesAtual < mesNascimento || (mesAtual === mesNascimento && hoje.getDate() < dataNascimento.getDate())) {
                idade--;
            }
        }

        return res.status(200).json({ 
            success: true, 
            user: { 
                id: user.id, 
                nome: user.nome, 
                email: user.email, 
                idade, 
                telefone: user.telefone ?? null, 
                genero: user.genero ?? null,
                foto_perfil_url: user.foto_perfil_url ?? null,
                foto_fundo_url: user.foto_fundo_url ?? null
            } 
        });
    } catch (error) {
        console.error('Erro ao atualizar perfil:', error);
        return res.status(500).json({ success: false, message: 'Não foi possível atualizar o perfil neste momento.' });
    }
}


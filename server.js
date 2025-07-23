const express = require('express');
const cors = require('cors');
const { Resend } = require('resend');
const { google } = require('googleapis');
require('dotenv').config();

const app = express();

// Inicializar Resend
const resend = new Resend(process.env.RESEND_API_KEY);

// Configurar Google Sheets
const googleAuth = new google.auth.GoogleAuth({
  credentials: {
    client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  },
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const sheets = google.sheets({ version: 'v4', auth: googleAuth });

// Função para salvar dados na planilha do Google
async function saveToGoogleSheets(data) {
  try {
    const { nome, email, cpf, tipo, descricao, valor, referencia } = data;
    
    const now = new Date();
    const dataFormatada = now.toLocaleString('pt-BR', {
      timeZone: 'America/Sao_Paulo'
    });

    const values = [[
      dataFormatada,
      nome || 'N/A',
      email || 'N/A', 
      cpf || 'N/A',
      tipo || 'N/A',
      descricao || 'N/A',
      valor || 'N/A',
      referencia || 'N/A',
      'Criado' // Status inicial
    ]];

    const resource = {
      values,
    };

    const result = await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.GOOGLE_SPREADSHEET_ID,
      range: 'A:I', // Colunas A até I
      valueInputOption: 'USER_ENTERED',
      resource,
    });

    console.log('Dados salvos na planilha:', result.data.updates);
    return true;
  } catch (error) {
    console.error('Erro ao salvar na planilha:', error);
    return false;
  }
}

// Função para atualizar status na planilha
async function updateStatusInSheet(referencia, novoStatus) {
  try {
    // Primeiro, buscar a linha com a referência
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SPREADSHEET_ID,
      range: 'A:I',
    });

    const rows = response.data.values;
    if (!rows || rows.length <= 1) return false;

    // Encontrar a linha com a referência
    let rowIndex = -1;
    for (let i = 1; i < rows.length; i++) { // Começar do índice 1 para pular o cabeçalho
      if (rows[i][7] === referencia) { // Coluna H (índice 7) é a referência
        rowIndex = i + 1; // +1 porque as planilhas começam do 1
        break;
      }
    }

    if (rowIndex === -1) {
      console.log('Referência não encontrada na planilha:', referencia);
      return false;
    }

    // Atualizar o status na coluna I
    await sheets.spreadsheets.values.update({
      spreadsheetId: process.env.GOOGLE_SPREADSHEET_ID,
      range: `I${rowIndex}`, // Coluna I da linha encontrada
      valueInputOption: 'USER_ENTERED',
      resource: {
        values: [[novoStatus]]
      }
    });

    console.log(`Status atualizado para '${novoStatus}' na linha ${rowIndex}`);
    return true;
  } catch (error) {
    console.error('Erro ao atualizar status na planilha:', error);
    return false;
  }
}

// Middleware para log de requisições
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// Configuração do CORS
app.use(cors());

app.use(express.json());

// Configuração do MercadoPago
const MERCADOPAGO_ACCESS_TOKEN = 'APP_USR-3116777758882381-060722-f41a1e898893ace269b2fc4ca1db3d2a-517719294';
const MERCADOPAGO_API_URL = 'https://api.mercadopago.com';

// Função para enviar email de confirmação
async function sendConfirmationEmail(paymentData) {
  try {
    const { payer, description, transaction_amount, external_reference } = paymentData;
    
    if (!payer?.email) {
      console.log('Email do pagador não encontrado');
      return false;
    }

    const emailHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background-color: #4CAF50; color: white; padding: 20px; text-align: center; }
          .content { padding: 20px; background-color: #f9f9f9; }
          .details { background-color: white; padding: 15px; margin: 15px 0; border-left: 4px solid #4CAF50; }
          .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🎉 Pagamento Confirmado!</h1>
          </div>
          
          <div class="content">
            <h2>Olá, ${payer.first_name || 'Cliente'}!</h2>
            
            <p>Seu pagamento foi processado com sucesso! Sua reserva no coworking está confirmada.</p>
            
            <div class="details">
              <h3>Detalhes da Reserva:</h3>
              <p><strong>Descrição:</strong> ${description}</p>
              <p><strong>Valor:</strong> R$ ${transaction_amount?.toFixed(2)}</p>
              <p><strong>Referência:</strong> ${external_reference}</p>
              <p><strong>Email:</strong> ${payer.email}</p>
            </div>
            
            <p>Em breve você receberá mais informações sobre como acessar o espaço.</p>
            
            <p>Caso tenha alguma dúvida, entre em contato conosco.</p>
            
            <p>Obrigado por escolher nosso coworking!</p>
          </div>
          
          <div class="footer">
            <p>Este é um email automático, não responda.</p>
            <p>Coworking - Espaços colaborativos</p>
          </div>
        </div>
      </body>
      </html>
    `;

    const result = await resend.emails.send({
      from: process.env.FROM_EMAIL || 'coworking@exemplo.com',
      to: payer.email,
      subject: '✅ Reserva Confirmada - Coworking',
      html: emailHtml
    });

    console.log('Email enviado com sucesso:', result);
    return true;
  } catch (error) {
    console.error('Erro ao enviar email:', error);
    return false;
  }
}

// Função para criar preferência usando a API REST
async function createPreference(preferenceData) {
  try {
    const response = await fetch(`${MERCADOPAGO_API_URL}/checkout/preferences`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${MERCADOPAGO_ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(preferenceData)
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Erro ao criar preferência');
    }

    return await response.json();
  } catch (error) {
    console.error('Erro na chamada à API do MercadoPago:', error);
    throw error;
  }
}

// Função para criar pagamento usando a API REST
async function createPayment(paymentData) {
  try {
    const response = await fetch(`${MERCADOPAGO_API_URL}/v1/payments`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${MERCADOPAGO_ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(paymentData)
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Erro ao criar pagamento');
    }

    return await response.json();
  } catch (error) {
    console.error('Erro na chamada à API do MercadoPago:', error);
    throw error;
  }
}

// Função para buscar pagamento usando a API REST
async function getPayment(paymentId) {
  try {
    const response = await fetch(`${MERCADOPAGO_API_URL}/v1/payments/${paymentId}`, {
      headers: {
        'Authorization': `Bearer ${MERCADOPAGO_ACCESS_TOKEN}`
      }
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Erro ao buscar pagamento');
    }

    return await response.json();
  } catch (error) {
    console.error('Erro na chamada à API do MercadoPago:', error);
    throw error;
  }
}

// Rota de health check
app.get('/api/health', (req, res) => {
  try {
    console.log('Health check realizado');
    res.status(200).json({ 
      status: 'ok',
      environment: process.env.NODE_ENV || 'development',
      timestamp: new Date().toISOString(),
      mercadopago: {
        token_defined: !!MERCADOPAGO_ACCESS_TOKEN
      },
      email: {
        resend_configured: !!process.env.RESEND_API_KEY,
        from_email: process.env.FROM_EMAIL || 'não configurado'
      },
      google_sheets: {
        configured: !!(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY && process.env.GOOGLE_SPREADSHEET_ID),
        spreadsheet_id: process.env.GOOGLE_SPREADSHEET_ID || 'não configurado'
      }
    });
  } catch (error) {
    console.error('Erro no health check:', error);
    res.status(500).json({ error: error.message });
  }
});

// Rota para criar preferência de pagamento
app.post('/api/create-preference', async (req, res) => {
  try {
    console.log('Criando preferência com dados:', req.body);
    let { description, payer, tipo, dias, mes, horario } = req.body;

    // Valores fixos
    const VALOR_MENSAL = 1;
    const VALOR_DIARIA = 1;
    const VALOR_HORA = 1;

    let amount = 0;

    // Lógica de cálculo do valor
    if (tipo === 'daily') {
      const quantidadeDias = Array.isArray(dias) ? dias.length : 1;
      amount = VALOR_DIARIA * quantidadeDias;
      description = `Reserva de coworking - Diária (${quantidadeDias} dia${quantidadeDias > 1 ? 's' : ''})`;
    } else if (tipo === 'monthly') {
      const quantidadeMes = mes || 1;
      amount = VALOR_MENSAL * quantidadeMes;
      description = `Reserva de coworking - Mensal (${quantidadeMes} mês${quantidadeMes > 1 ? 'es' : ''})`;
    } else if (tipo === 'hourly') {
      const quantidadeHoras = horario || 1;
      const quantidadeDias = Array.isArray(dias) ? dias.length : 1;
      amount = VALOR_HORA * quantidadeHoras * quantidadeDias;
      description = `Reserva de coworking - Por Hora (${quantidadeHoras} hora${quantidadeHoras > 1 ? 's' : ''} em ${quantidadeDias} dia${quantidadeDias > 1 ? 's' : ''})`;
    }

    if (!amount || !description) {
      return res.status(400).json({ 
        error: 'Dados inválidos',
        details: 'Não foi possível calcular o valor do pagamento. Verifique os campos enviados.'
      });
    }

    const preference = {
      items: [
        {
          title: description,
          unit_price: Number(amount),
          quantity: 1,
          currency_id: 'BRL'
        }
      ],
      payer: {
        name: payer?.name,
        email: payer?.email,
        identification: {
          type: payer?.identification?.type || 'CPF',
          number: payer?.identification?.number
        }
      },
      back_urls: {
        success: "https://coworking-navy.vercel.app/payment-success",
        failure: "https://coworking-navy.vercel.app/pending",
        pending: "https://coworking-navy.vercel.app/pending"
      },
      auto_return: "approved",
      payment_methods: {
        excluded_payment_methods: [],
        excluded_payment_types: [],
        installments: 1
      },
      statement_descriptor: "COWORKING",
      external_reference: "COWORKING-" + Date.now(),
      binary_mode: true
    };

    console.log('Enviando preferência para MercadoPago:', preference);
    const response = await createPreference(preference);
    console.log('Preferência criada com sucesso:', response.id);
    
    // Salvar dados na planilha do Google
    const dadosParaPlanilha = {
      nome: payer?.name,
      email: payer?.email,
      cpf: payer?.identification?.number,
      tipo: tipo,
      descricao: description,
      valor: `R$ ${amount.toFixed(2)}`,
      referencia: preference.external_reference
    };
    
    console.log('Salvando dados na planilha...');
    const salvouNaPlanilha = await saveToGoogleSheets(dadosParaPlanilha);
    
    if (salvouNaPlanilha) {
      console.log('Dados salvos na planilha com sucesso');
    } else {
      console.log('Erro ao salvar dados na planilha');
    }
    
    res.json({
      id: response.id,
      init_point: response.init_point,
      external_reference: preference.external_reference,
      saved_to_sheet: salvouNaPlanilha
    }); 
  } catch (error) {
    console.error('Erro ao criar preferência:', error);
    console.error('Stack trace:', error.stack);
    res.status(500).json({ 
      error: error.message,
      details: error.response?.data || 'Sem detalhes adicionais'
    });
  }
});

// Rota para processar pagamento
app.post('/api/create-payment/process', async (req, res) => {
  try {
    const { 
      paymentType,
      selectedPaymentMethod,
      formData,
      amount,
      description,
      payer 
    } = req.body;

    // Validação do valor da transação
    if (!amount || isNaN(Number(amount))) {
      return res.status(400).json({ error: 'Valor da transação inválido' });
    }

    // Validação dos dados do pagador
    if (!payer || !payer.email || !payer.identification || !payer.name) {
      return res.status(400).json({ error: 'Dados do pagador inválidos' });
    }

    // Se for cartão de crédito, primeiro criamos o token
    if (paymentType === 'credit_card') {
      try {
        // Dados do cartão de teste (Mastercard)
        const cardData = {
          card_number: '5031433215406351',
          cardholder_name: payer.name,
          expiration_month: '11',
          expiration_year: '2030',
          security_code: '123',
          identification_type: "CPF",
          identification_number: "14444807741"
        };

        // Criar token do cartão usando a API do MercadoPago
        const response = await fetch('https://api.mercadopago.com/v1/card_tokens', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.MERCADO_PAGO_ACCESS_TOKEN}`
          },
          body: JSON.stringify(cardData)
        });

        const cardToken = await response.json();
        console.log('Token do cartão criado:', cardToken);

        if (!cardToken.id) {
          throw new Error('Erro ao criar token do cartão');
        }

        const payment_data = {
          transaction_amount: Number(amount),
          token: cardToken.id,
          description: description || 'Pagamento Coworking',
          installments: 1,
          payment_method_id: 'master',
          payer: {
            email: payer.email,
            identification: {
              type: payer.identification.type,
              number: payer.identification.number
            },
            first_name: payer.name.split(' ')[0],
            last_name: payer.name.split(' ').slice(1).join(' ')
          }
        };

        console.log('Dados do pagamento:', payment_data);

        const payment = await mercadopago.payment.create(payment_data);
        res.json(payment.body);
      } catch (error) {
        console.error('Erro ao criar token do cartão:', error);
        res.status(500).json({ error: 'Erro ao processar cartão de crédito' });
      }
    } else {
      // Para outros métodos de pagamento
      const payment_data = {
        transaction_amount: Number(amount),
        description: description || 'Pagamento Coworking',
        payment_method_id: selectedPaymentMethod,
        installments: 1,
        payer: {
          email: payer.email,
          identification: payer.identification,
          first_name: payer.name.split(' ')[0],
          last_name: payer.name.split(' ').slice(1).join(' ')
        }
      };

      console.log('Dados do pagamento:', payment_data);

      const payment = await mercadopago.payment.create(payment_data);
      res.json(payment.body);
    }
  } catch (error) {
    console.error('Erro ao processar pagamento:', error);
    console.error('Stack trace:', error.stack);
    res.status(500).json({ 
      error: error.message,
      details: error.response?.data || 'Sem detalhes adicionais'
    });
  }
});

// Rota para testar pagamento com cartão de teste
app.post('/api/test-payment', async (req, res) => {
  try {
    const { amount, description } = req.body;

    // Validação do valor
    if (!amount || isNaN(Number(amount))) {
      return res.status(400).json({ error: 'Valor inválido' });
    }

    const payment_data = {
      transaction_amount: Number(amount),
      token: 'TEST_TOKEN',
      description: description || 'Teste de pagamento',
      installments: 1,
      payment_method_id: 'visa',
      issuer_id: '1',
      payer: {
        email: 'test@test.com',
        identification: {
          type: 'CPF',
          number: '12345678909'
        }
      }
    };

    console.log('Dados do pagamento de teste:', payment_data);

    const payment = await mercadopago.payment.create(payment_data);
    res.json(payment.body);
  } catch (error) {
    console.error('Erro ao processar pagamento de teste:', error);
    res.status(500).json({ error: error.message });
  }
});

// Rota para verificar status do pagamento - MODIFICADA PARA ENVIAR EMAIL
app.get('/api/payment/:id', async (req, res) => {
  try {
    const paymentId = req.params.id;
    console.log('Verificando status do pagamento:', paymentId);
    
    const payment = await getPayment(paymentId);
    console.log('Status do pagamento:', payment.status);
    
    // Se o pagamento foi aprovado, enviar email de confirmação
    if (payment.status === 'approved') {
      console.log('Pagamento aprovado, enviando email de confirmação...');
      const emailSent = await sendConfirmationEmail(payment);
      
      if (emailSent) {
        console.log('Email de confirmação enviado com sucesso');
      } else {
        console.log('Falha ao enviar email de confirmação');
      }
      
      // Atualizar status na planilha
      if (payment.external_reference) {
        console.log('Atualizando status na planilha...');
        const statusAtualizado = await updateStatusInSheet(payment.external_reference, 'Pago');
        
        if (statusAtualizado) {
          console.log('Status atualizado na planilha');
        } else {
          console.log('Erro ao atualizar status na planilha');
        }
      }
    }
    
    res.json(payment);
  } catch (error) {
    console.error('Erro ao verificar pagamento:', error);
    res.status(500).json({ 
      error: error.message,
      details: error.response?.data || 'Sem detalhes adicionais'
    });
  }
});

// Rota para webhook - MODIFICADA PARA ENVIAR EMAIL
app.post('/api/webhook', async (req, res) => {
  try {
    console.log('Webhook recebido:', req.body);
    const { type, data } = req.body;
    
    if (type === 'payment') {
      const payment = await getPayment(data.id);
      console.log('Detalhes do pagamento via webhook:', payment);
      
      // Se o pagamento foi aprovado, enviar email de confirmação
      if (payment.status === 'approved') {
        console.log('Pagamento aprovado via webhook, enviando email...');
        const emailSent = await sendConfirmationEmail(payment);
        
        if (emailSent) {
          console.log('Email de confirmação enviado com sucesso via webhook');
        } else {
          console.log('Falha ao enviar email de confirmação via webhook');
        }
        
        // Atualizar status na planilha
        if (payment.external_reference) {
          console.log('Atualizando status na planilha via webhook...');
          const statusAtualizado = await updateStatusInSheet(payment.external_reference, 'Pago');
          
          if (statusAtualizado) {
            console.log('Status atualizado na planilha via webhook');
          } else {
            console.log('Erro ao atualizar status na planilha via webhook');
          }
        }
      }
    }
    
    res.status(200).send('OK');
  } catch (error) {
    console.error('Erro no webhook:', error);
    console.error('Stack trace:', error.stack);
    res.status(500).json({ 
      error: error.message,
      details: error.response?.data || 'Sem detalhes adicionais'
    });
  }
});

// Nova rota para testar integração com Google Sheets
app.post('/api/test-sheets', async (req, res) => {
  try {
    const testData = {
      nome: 'Teste da Silva',
      email: 'teste@exemplo.com',
      cpf: '123.456.789-00',
      tipo: 'daily',
      descricao: 'Teste de integração',
      valor: 'R$ 10,00',
      referencia: 'TEST-' + Date.now()
    };

    console.log('Testando salvamento na planilha...');
    const saved = await saveToGoogleSheets(testData);
    
    if (saved) {
      res.json({ success: true, message: 'Dados de teste salvos na planilha!' });
    } else {
      res.status(500).json({ success: false, message: 'Erro ao salvar na planilha' });
    }
  } catch (error) {
    console.error('Erro no teste da planilha:', error);
    res.status(500).json({ error: error.message });
  }
});

// Nova rota para testar envio de email
app.post('/api/test-email', async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({ error: 'Email é obrigatório' });
    }

    const testPayment = {
      payer: {
        email: email,
        first_name: 'Teste'
      },
      description: 'Teste de envio de email',
      transaction_amount: 10.00,
      external_reference: 'TEST-' + Date.now()
    };

    const emailSent = await sendConfirmationEmail(testPayment);
    
    if (emailSent) {
      res.json({ success: true, message: 'Email de teste enviado com sucesso!' });
    } else {
      res.status(500).json({ success: false, message: 'Falha ao enviar email de teste' });
    }
  } catch (error) {
    console.error('Erro ao testar email:', error);
    res.status(500).json({ error: error.message });
  }
});

// Exporta a aplicação para o Vercel
module.exports = app;

// Inicia o servidor
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
  console.log('Ambiente:', process.env.NODE_ENV || 'development');
  console.log('MercadoPago token configurado:', !!MERCADOPAGO_ACCESS_TOKEN);
  console.log('Resend API key configurado:', !!process.env.RESEND_API_KEY);
  console.log('Google Sheets configurado:', !!(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY && process.env.GOOGLE_SPREADSHEET_ID));
});
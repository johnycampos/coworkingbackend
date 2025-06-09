const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();

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
    const { amount, description, payer } = req.body;

    if (!amount || !description) {
      return res.status(400).json({ 
        error: 'Dados inválidos',
        details: 'amount e description são obrigatórios'
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
        success: "https://coworking-navy.vercel.app/success",
        failure: "https://coworking-navy.vercel.app/failure",
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
    
    res.json({
      id: response.id,
      init_point: response.init_point
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

// Rota para verificar status do pagamento
app.get('/api/payment/:id', async (req, res) => {
  try {
    const paymentId = req.params.id;
    console.log('Verificando status do pagamento:', paymentId);
    
    const payment = await getPayment(paymentId);
    console.log('Status do pagamento:', payment.status);
    
    res.json(payment);
  } catch (error) {
    console.error('Erro ao verificar pagamento:', error);
    res.status(500).json({ 
      error: error.message,
      details: error.response?.data || 'Sem detalhes adicionais'
    });
  }
});

// Rota para webhook
app.post('/api/webhook', async (req, res) => {
  try {
    console.log('Webhook recebido:', req.body);
    const { type, data } = req.body;
    
    if (type === 'payment') {
      const payment = await getPayment(data.id);
      console.log('Detalhes do pagamento:', payment);
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

// Exporta a aplicação para o Vercel
module.exports = app;

// Inicia o servidor
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
  console.log('Ambiente:', process.env.NODE_ENV || 'development');
  console.log('MercadoPago token configurado:', !!MERCADOPAGO_ACCESS_TOKEN);
});
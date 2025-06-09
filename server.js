const express = require('express');
const cors = require('cors');
const mercadopago = require('mercadopago');
require('dotenv').config();

const app = express();

// Configuração do CORS
app.use(cors());

app.use(express.json());

// Verificação do token do MercadoPago
if (!process.env.MERCADO_PAGO_ACCESS_TOKEN) {
  console.error('ERRO: Token do MercadoPago não encontrado!');
  console.error('Por favor, crie um arquivo .env com a variável MERCADO_PAGO_ACCESS_TOKEN');
  process.exit(1);
}

// Configuração do MercadoPago
mercadopago.configure({
  access_token: process.env.MERCADO_PAGO_ACCESS_TOKEN
});

// Dados de teste para cartão Visa
const TEST_CARD = {
  number: '4235647728025682',
  expirationMonth: '12',
  expirationYear: '2025',
  securityCode: '123',
  cardholderName: 'APRO',
  identification: {
    type: 'CPF',
    number: '12345678909'
  }
};

// Rota para criar preferência de pagamento
app.post('/api/create-payment', async (req, res) => {
  try {
    const { amount, description, payer } = req.body;

    // Validação do valor da transação
    if (!amount || isNaN(Number(amount))) {
      return res.status(400).json({ error: 'Valor da transação inválido' });
    }

    // URLs de retorno baseadas no ambiente
    const baseUrl = process.env.NODE_ENV === 'production' 
      ? 'https://coworking-navy.vercel.app/' 
      : 'http://localhost:5173';

    // Criar preferência de pagamento
    const preference = {
      items: [
        {
          title: description || 'Reserva de Coworking',
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
        success: `${baseUrl}/payment-success`,
        failure: `${baseUrl}/payment-failure`,
        pending: `${baseUrl}/payment-pending`
      },
      payment_methods: {
        excluded_payment_methods: [],
        excluded_payment_types: [],
        installments: 1
      },
      notification_url: process.env.NODE_ENV === 'production'
        ? 'https://seu-backend.vercel.app/api/webhook'
        : 'http://localhost:3001/api/webhook',
      statement_descriptor: "COWORKING",
      external_reference: "COWORKING-" + Date.now(),
      binary_mode: true
    };

    console.log('Criando preferência:', preference);

    const response = await mercadopago.preferences.create(preference);
    console.log('Preferência criada:', response.body);

    res.json({
      id: response.body.id,
      init_point: response.body.init_point
    });
  } catch (error) {
    console.error('Erro ao criar preferência:', error);
    res.status(500).json({ error: error.message });
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
    res.status(500).json({ error: error.message });
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

// Rota para webhook
app.post('/api/webhook', async (req, res) => {
  try {
    const { type, data } = req.body;

    if (type === 'payment') {
      const payment = await mercadopago.payment.findById(data.id);
      console.log('Webhook - Pagamento:', payment.body);

      // Aqui você pode processar o pagamento conforme necessário
      // Por exemplo, atualizar o status da reserva no banco de dados
    }

    res.status(200).send('OK');
  } catch (error) {
    console.error('Erro no webhook:', error);
    res.status(500).json({ error: error.message });
  }
});

// Rota para verificar status do pagamento
app.get('/api/payment/:id', async (req, res) => {
  try {
    const payment = await mercadopago.payment.findById(req.params.id);
    res.json(payment.body);
  } catch (error) {
    console.error('Erro ao verificar pagamento:', error);
    res.status(500).json({ error: error.message });
  }
});

// Rota de health check
app.get('/api/health', (req, res) => {
  const healthcheck = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development',
    memory: process.memoryUsage(),
    mercadopago: {
      configured: !!process.env.MERCADO_PAGO_ACCESS_TOKEN
    }
  };

  try {
    res.json(healthcheck);
  } catch (error) {
    healthcheck.status = 'error';
    healthcheck.error = error.message;
    res.status(500).json(healthcheck);
  }
});

// Exporta a aplicação para o Vercel
module.exports = app;

// Inicia o servidor apenas se não estiver em ambiente serverless
if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 5000;
  app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
  });
}
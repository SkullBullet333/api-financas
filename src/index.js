require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { PrismaClient } = require('@prisma/client');
const { Pool } = require('pg');
const { PrismaPg } = require('@prisma/adapter-pg');

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false }
});
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const app = express();
app.use(cors());
app.use(express.json());

// ==================== DESPESAS ====================
app.get('/api/despesas', async (req, res) => {
    try {
        const despesas = await prisma.despesa.findMany({ orderBy: { vencimento: 'asc' } });
        res.json(despesas);
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/despesas', async (req, res) => {
    try {
        const dados = req.body;
        const nova = await prisma.despesa.create({
            data: {
                descricao: dados.descricao,
                categoria: dados.categoria || "",
                valor: Number(dados.valor),
                vencimento: new Date(dados.vencimento),
                titular: dados.titular,
                competencia: dados.competencia,
                simulada: dados.simulada || false
            }
        });
        res.json({ sucesso: true, despesa: nova });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// ==================== RECEITAS ====================
app.get('/api/receitas', async (req, res) => {
    try {
        const receitas = await prisma.receita.findMany({ orderBy: { recebimento: 'asc' } });
        res.json(receitas);
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/receitas', async (req, res) => {
    try {
        const dados = req.body;
        const nova = await prisma.receita.create({
            data: {
                descricao: dados.descricao,
                valor: Number(dados.valor),
                recebimento: new Date(dados.recebimento),
                titular: dados.titular,
                competencia: dados.competencia,
                simulada: dados.simulada || false
            }
        });
        res.json({ sucesso: true, receita: nova });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// ==================== CARTÕES ====================
app.get('/api/cartoes', async (req, res) => {
    try {
        const cartoes = await prisma.cartaoGasto.findMany({ orderBy: { vencimento: 'asc' } });
        res.json(cartoes);
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/cartoes', async (req, res) => {
    try {
        const dados = req.body;
        const novo = await prisma.cartaoGasto.create({
            data: {
                cartao: dados.cartao,
                descricao: dados.descricao,
                categoria: dados.categoria || "",
                valor: Number(dados.valor),
                vencimento: new Date(dados.vencimento),
                titular: dados.titular,
                competencia: dados.competencia,
                simulada: dados.simulada || false
            }
        });
        res.json({ sucesso: true, cartaoGasto: novo });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
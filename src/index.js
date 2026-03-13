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
        const id = dados.id || dados.linha;

        if (id) {
            const atualizada = await prisma.despesa.update({
                where: { id: Number(id) },
                data: {
                    descricao: dados.descricao,
                    categoria: dados.categoria || "",
                    valor: Number(dados.valor),
                    vencimento: new Date(dados.vencimento),
                    titular: dados.titular,
                    status: dados.status || "Em aberto",
                    competencia: dados.competencia,
                    simulada: dados.simulada || false
                }
            });
            res.json({ sucesso: true, despesa: atualizada });
        } else {
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
        }
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
        const id = dados.id || dados.linha;

        if (id) {
            const atualizada = await prisma.receita.update({
                where: { id: Number(id) },
                data: {
                    descricao: dados.descricao,
                    valor: Number(dados.valor),
                    recebimento: new Date(dados.recebimento),
                    titular: dados.titular,
                    competencia: dados.competencia,
                    simulada: dados.simulada || false
                }
            });
            res.json({ sucesso: true, receita: atualizada });
        } else {
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
        }
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
        const id = dados.id || dados.linha;

        if (id) {
            const atualizada = await prisma.cartaoGasto.update({
                where: { id: Number(id) },
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
            res.json({ sucesso: true, cartaoGasto: atualizada });
        } else {
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
        }
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// ==================== AUTHENTICATION ====================
app.post('/api/login', async (req, res) => {
    try {
        const { usuario, senha } = req.body;
        const userFound = await prisma.usuario.findUnique({ where: { nome: usuario } });
        
        if (userFound && userFound.senha === senha) {
            res.json({ sucesso: true, usuario: userFound.nome });
        } else {
            res.json({ sucesso: false, erro: "Usuário ou senha inválidos" });
        }
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// ==================== CONFIGS ====================
app.get('/api/configs', async (req, res) => {
    try {
        const [titulares, cartoes, categorias] = await Promise.all([
            prisma.usuario.findMany(),
            prisma.cartaoConfig.findMany(),
            prisma.categoria.findMany()
        ]);
        
        res.json({
            titulares: titulares.map(t => ({ nome: t.nome, foto: t.foto, linha: t.id })),
            cartoes: cartoes.map(c => ({ ...c, linha: c.id })),
            categorias: categorias.map(c => ({ label: c.nome, keywords: c.palavrasChave, linha: c.id }))
        });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/configs', async (req, res) => {
    try {
        const { tipo, valor, id } = req.body;
        
        if (tipo === 'titulares') {
            const nome = typeof valor === 'object' ? valor.nome : valor;
            const foto = typeof valor === 'object' ? valor.foto : null;
            
            if (!nome) throw new Error("Nome do titular é obrigatório");

            await prisma.usuario.upsert({
                where: { nome },
                update: { foto: foto || undefined },
                create: { nome, senha: '123', foto }
            });
        } else if (tipo === 'cartoes') {
            const [nome, titular, diaVencimento, diaFechamento] = valor;
            const data = { 
                nome, 
                titular, 
                diaVencimento: Number(diaVencimento || 10), 
                diaFechamento: Number(diaFechamento || 0) 
            };

            if (id) {
                await prisma.cartaoConfig.update({
                    where: { id: Number(id) },
                    data
                });
            } else {
                await prisma.cartaoConfig.create({ data });
            }
        } else if (tipo === 'categorias') {
            const nome = Array.isArray(valor) ? valor[0] : (typeof valor === 'object' ? valor.nome : valor);
            const palavrasChave = Array.isArray(valor) ? valor[1] : (typeof valor === 'object' ? valor.palavrasChave : "");

            await prisma.categoria.upsert({
                where: { nome },
                update: { palavrasChave },
                create: { nome, palavrasChave }
            });
        }
        
        const [t, ca, cate] = await Promise.all([
            prisma.usuario.findMany(),
            prisma.cartaoConfig.findMany(),
            prisma.categoria.findMany()
        ]);
        res.json({
            titulares: t.map(u => ({ nome: u.nome, foto: u.foto, linha: u.id })),
            cartoes: ca.map(c => ({ ...c, linha: c.id })),
            categorias: cate.map(c => ({ label: c.nome, keywords: c.palavrasChave, linha: c.id }))
        });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.delete('/api/configs/:tipo', async (req, res) => {
    try {
        const { tipo } = req.params;
        const { valor } = req.query;
        if (tipo === 'titulares') {
            await prisma.usuario.delete({ where: { nome: valor } });
        } else if (tipo === 'cartoes') {
            const [nome, titular] = valor.split('|');
            const cartaoConfig = await prisma.cartaoConfig.findFirst({ where: { nome, titular } });
            if (cartaoConfig) await prisma.cartaoConfig.delete({ where: { id: cartaoConfig.id } });
        } else if (tipo === 'categorias') {
            await prisma.categoria.delete({ where: { id: Number(valor) } });
        }
        const [t, ca, cate] = await Promise.all([
            prisma.usuario.findMany(),
            prisma.cartaoConfig.findMany(),
            prisma.categoria.findMany()
        ]);
        res.json({
            titulares: t.map(u => ({ nome: u.nome, foto: u.foto, linha: u.id })),
            cartoes: ca.map(c => ({ ...c, linha: c.id })),
            categorias: cate.map(c => ({ label: c.nome, keywords: c.palavrasChave, linha: c.id }))
        });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// ==================== NOTAS E LIMPEZA ====================
app.post('/api/notas', async (req, res) => {
    try {
        const { nota } = req.body;
        await prisma.nota.upsert({
            where: { id: 1 },
            update: { texto: nota },
            create: { id: 1, texto: nota }
        });
        res.json({ sucesso: true });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/limpar', async (req, res) => {
    try {
        const { tipo } = req.body;
        if (tipo === 'simulacoes' || tipo === 'despesas') await prisma.despesa.deleteMany({ where: { simulada: true } });
        if (tipo === 'simulacoes' || tipo === 'receitas') await prisma.receita.deleteMany({ where: { simulada: true } });
        if (tipo === 'simulacoes' || tipo === 'cartoes') await prisma.cartaoGasto.deleteMany({ where: { simulada: true } });
        res.json({ sucesso: true });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// ==================== DELETE ENTITIES ====================
app.delete('/api/despesas/:id', async (req, res) => {
    try {
        await prisma.despesa.delete({ where: { id: Number(req.params.id) } });
        res.json({ sucesso: true });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.delete('/api/receitas/:id', async (req, res) => {
    try {
        await prisma.receita.delete({ where: { id: Number(req.params.id) } });
        res.json({ sucesso: true });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.delete('/api/cartoes/:id', async (req, res) => {
    try {
        await prisma.cartaoGasto.delete({ where: { id: Number(req.params.id) } });
        res.json({ sucesso: true });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
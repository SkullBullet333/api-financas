const express = require('express');
const { PrismaClient } = require('@prisma/client');
const cors = require('cors');
require('dotenv').config();

const { Pool } = require('pg');
const { PrismaPg } = require('@prisma/adapter-pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const app = express();
app.use(cors());
app.use(express.json());

// ==================== UTILITÁRIOS DE DATA E COMPETÊNCIA ====================

function calcularCompetencia(data) {
    let d = new Date(data);
    d.setHours(12, 0, 0, 0);
    let dia = d.getDate();
    let ano = d.getFullYear();
    let mes = d.getMonth();
    let ultimoDia = new Date(ano, mes + 1, 0).getDate();

    let targetMes = mes;
    let targetAno = ano;

    if (dia === ultimoDia) {
        targetMes++;
        if (targetMes > 11) {
            targetMes = 0;
            targetAno++;
        }
    }

    return ("0" + (targetMes + 1)).slice(-2) + "/" + targetAno;
}

function calcularCompetenciaCartao(dataCompra, diaVencimento, diasFechamento) {
    let d = new Date(dataCompra);
    d.setHours(12, 0, 0, 0);

    let mesVencimento = d.getMonth();
    let anoVencimento = d.getFullYear();
    let dataVencimentoFatura = new Date(anoVencimento, mesVencimento, diaVencimento, 12, 0, 0);
    
    if (d.getDate() > diaVencimento) {
        dataVencimentoFatura.setMonth(dataVencimentoFatura.getMonth() + 1);
    }

    let dataFechamento = new Date(dataVencimentoFatura);
    dataFechamento.setDate(dataVencimentoFatura.getDate() - diasFechamento);

    if (d.getTime() >= dataFechamento.getTime()) {
        dataVencimentoFatura.setMonth(dataVencimentoFatura.getMonth() + 1);
    }

    let finalMes = dataVencimentoFatura.getMonth() + 1;
    let finalAno = dataVencimentoFatura.getFullYear();

    return ("0" + finalMes).slice(-2) + "/" + finalAno;
}

function calcularCompetenciaReceita(data) {
    let d = new Date(data);
    d.setHours(12, 0, 0, 0);
    let dia = d.getDate();
    let mes = d.getMonth();
    let ano = d.getFullYear();

    if (dia >= 28) {
        mes++;
        if (mes > 11) {
            mes = 0;
            ano++;
        }
    }
    return ("0" + (mes + 1)).slice(-2) + "/" + ano;
}

function ajustarDataReceita(data) {
    let d = new Date(data);
    d.setHours(12, 0, 0, 0);

    if (d.getDate() === 1) {
        let count = 0;
        let target = new Date(d.getFullYear(), d.getMonth(), 1, 12, 0, 0);
        while (count < 5) {
            let day = target.getDay();
            if (day !== 0 && day !== 6) {
                count++;
            }
            if (count < 5) {
                target.setDate(target.getDate() + 1);
            }
        }
        return target;
    }

    let diaSemana = d.getDay();
    if (diaSemana === 6) { 
        d.setDate(d.getDate() - 1);
    } else if (diaSemana === 0) { 
        d.setDate(d.getDate() - 2);
    }

    return d;
}

function projetarProximoVencimento(dataBase, mesesAdicionais, isUltimoDiaOriginal, diaOriginal, pularFimDeSemana = true) {
    let d = new Date(dataBase.getFullYear(), dataBase.getMonth() + mesesAdicionais, 1, 12, 0, 0);

    if (isUltimoDiaOriginal) {
        d.setMonth(d.getMonth() + 1);
        d.setDate(0);
    } else {
        let ultimoDiaMesAlvo = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
        d.setDate(Math.min(diaOriginal, ultimoDiaMesAlvo));
    }

    if (pularFimDeSemana) {
        let diaSemana = d.getDay();
        if (diaSemana === 6) { 
            d.setDate(d.getDate() + 2);
        } else if (diaSemana === 0) { 
            d.setDate(d.getDate() + 1);
        }
    }

    return d;
}

// ==================== CONSOLIDAÇÃO DE FATURAS ====================

async function consolidarFaturas(competencia) {
    try {
        console.log(`Consolidando faturas para: ${competencia}`);
        const configs = await prisma.cartaoConfig.findMany();
        const diasVencimento = {};
        configs.forEach(c => {
            diasVencimento[`${c.nome}|${c.titular}`] = c.diaVencimento;
        });

        if (!competencia) {
            const hoje = new Date();
            competencia = ("0" + (hoje.getMonth() + 1)).slice(-2) + "/" + hoje.getFullYear();
        }

        const gastos = await prisma.cartaoGasto.findMany({
            where: { competencia }
        });

        const totais = {};
        gastos.forEach(g => {
            const chave = `${g.cartao}|${g.titular}`;
            if (!totais[chave]) totais[chave] = 0;
            totais[chave] += g.valor;
        });

        for (const chave in totais) {
            const [nomeCartao, titular] = chave.split('|');
            const valorTotal = totais[chave];
            const diaVenc = diasVencimento[chave] || 10;

            const [mes, ano] = competencia.split('/').map(Number);
            const dataVenc = projetarProximoVencimento(new Date(ano, mes - 1, 1), 0, diaVenc === 31, diaVenc);

            // Tentar encontrar despesa existente de fatura
            const despesaFatura = await prisma.despesa.findFirst({
                where: {
                    descricao: nomeCartao,
                    titular: titular,
                    competencia: competencia,
                    categoria: "Cartão"
                }
            });

            if (despesaFatura) {
                await prisma.despesa.update({
                    where: { id: despesaFatura.id },
                    data: { valor: valorTotal, vencimento: dataVenc }
                });
            } else {
                await prisma.despesa.create({
                    data: {
                        descricao: nomeCartao,
                        categoria: "Cartão",
                        valor: valorTotal,
                        vencimento: dataVenc,
                        titular: titular,
                        competencia: competencia,
                        status: "Em aberto"
                    }
                });
            }
        }
    } catch (error) {
        console.error('Erro consolidarFaturas:', error);
    }
}

// ==================== ENDPOINTS ====================

app.get('/api/despesas', async (req, res) => {
    try {
        const despesas = await prisma.despesa.findMany({ orderBy: { vencimento: 'asc' } });
        res.json(despesas.map(d => ({ ...d, linha: d.id, vencimentoIso: d.vencimento.toISOString().split('T')[0] })));
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/despesas', async (req, res) => {
    try {
        const d = req.body;
        if (d.id || d.linha) {
            const id = d.id || d.linha;
            const dataV = new Date(d.vencimento);
            const comp = calcularCompetencia(dataV);
            const updated = await prisma.despesa.update({
                where: { id: Number(id) },
                data: {
                    descricao: d.descricao,
                    categoria: d.categoria,
                    valor: Number(d.valor),
                    vencimento: dataV,
                    titular: d.titular,
                    status: d.status || "Em aberto",
                    competencia: comp,
                    simulada: d.simulada === true || d.simulada === 'SIM'
                }
            });
            res.json(updated);
        } else {
            const parcelas = Number(d.totalParcelas || 1);
            const valorParcela = Number(d.valor || 0);
            const partesData = d.vencimento.split("-");
            const diaOriginal = Number(partesData[2]);
            const dataInicial = new Date(partesData[0], partesData[1] - 1, diaOriginal, 12, 0, 0);
            const isUltimoDay = (diaOriginal === new Date(dataInicial.getFullYear(), dataInicial.getMonth() + 1, 0).getDate());

            const created = [];
            for (let i = 1; i <= parcelas; i++) {
                const v = projetarProximoVencimento(dataInicial, i - 1, isUltimoDay, diaOriginal);
                const comp = calcularCompetencia(v);
                const item = await prisma.despesa.create({
                    data: {
                        descricao: d.descricao,
                        categoria: d.categoria,
                        valor: valorParcela,
                        parcelaAtual: i,
                        totalParcelas: parcelas,
                        vencimento: v,
                        titular: d.titular,
                        competencia: comp,
                        simulada: d.simulada === true || d.simulada === 'SIM'
                    }
                });
                created.push(item);
            }
            res.json(created[0]);
        }
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/receitas', async (req, res) => {
    try {
        const receitas = await prisma.receita.findMany({ orderBy: { recebimento: 'asc' } });
        res.json(receitas.map(r => ({ ...r, linha: r.id, recebimentoIso: r.recebimento.toISOString().split('T')[0] })));
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/receitas', async (req, res) => {
    try {
        const d = req.body;
        if (d.id || d.linha) {
            const id = d.id || d.linha;
            let dataR = new Date(d.recebimento);
            const comp = calcularCompetenciaReceita(dataR);
            dataR = ajustarDataReceita(dataR);
            const updated = await prisma.receita.update({
                where: { id: Number(id) },
                data: {
                    descricao: d.descricao,
                    valor: Number(d.valor),
                    recebimento: dataR,
                    titular: d.titular,
                    competencia: comp,
                    simulada: d.simulada === true || d.simulada === 'SIM'
                }
            });
            res.json(updated);
        } else {
            const parcelas = Number(d.totalParcelas || 1);
            const valorParcela = Number(d.valor || 0);
            const partesData = d.recebimento.split("-");
            const diaOriginal = Number(partesData[2]);
            const dataInicial = new Date(partesData[0], partesData[1] - 1, diaOriginal, 12, 0, 0);
            const isUltimoDay = (diaOriginal === new Date(dataInicial.getFullYear(), dataInicial.getMonth() + 1, 0).getDate());

            const created = [];
            for (let i = 1; i <= parcelas; i++) {
                let v = projetarProximoVencimento(dataInicial, i - 1, isUltimoDay, diaOriginal, false);
                const comp = calcularCompetenciaReceita(v);
                v = ajustarDataReceita(v);
                const item = await prisma.receita.create({
                    data: {
                        descricao: d.descricao,
                        valor: valorParcela,
                        recebimento: v,
                        titular: d.titular,
                        competencia: comp,
                        simulada: d.simulada === true || d.simulada === 'SIM'
                    }
                });
                created.push(item);
            }
            res.json(created[0]);
        }
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/cartoes', async (req, res) => {
    try {
        const gastos = await prisma.cartaoGasto.findMany({ orderBy: { vencimento: 'asc' } });
        res.json(gastos.map(g => ({ ...g, linha: g.id, vencimentoIso: g.vencimento.toISOString().split('T')[0] })));
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/cartoes', async (req, res) => {
    try {
        const d = req.body;
        if (d.id || d.linha) {
            const id = d.id || d.linha;
            const dataV = new Date(d.vencimento);
            const comp = calcularCompetencia(dataV);
            const updated = await prisma.cartaoGasto.update({
                where: { id: Number(id) },
                data: {
                    cartao: d.cartao,
                    descricao: d.descricao,
                    categoria: d.categoria,
                    valor: Number(d.valor),
                    vencimento: dataV,
                    titular: d.titular,
                    competencia: comp,
                    simulada: d.simulada === true || d.simulada === 'SIM'
                }
            });
            await consolidarFaturas(comp);
            res.json(updated);
        } else {
            const parcelas = Number(d.totalParcelas || 1);
            const valorParcela = Number(d.valor || 0);
            const partesData = d.vencimento.split("-");
            const diaOriginal = Number(partesData[2]);
            const dataInicial = new Date(partesData[0], partesData[1] - 1, diaOriginal, 12, 0, 0);
            const isUltimoDay = (diaOriginal === new Date(dataInicial.getFullYear(), dataInicial.getMonth() + 1, 0).getDate());

            let compInicial = null;
            if (d.diasFechamento !== undefined) {
                compInicial = calcularCompetenciaCartao(new Date(), Number(d.diaVencimento || 10), Number(d.diasFechamento || 0));
            }

            const created = [];
            const compsAfetadas = new Set();
            for (let i = 1; i <= parcelas; i++) {
                const v = projetarProximoVencimento(dataInicial, i - 1, isUltimoDay, diaOriginal);
                let comp;
                if (i === 1 && compInicial) {
                    comp = compInicial;
                } else if (i > 1 && compInicial) {
                    const [m, a] = compInicial.split('/').map(Number);
                    const dAux = new Date(a, m - 1 + (i - 1), 1, 12, 0, 0);
                    comp = ("0" + (dAux.getMonth() + 1)).slice(-2) + "/" + dAux.getFullYear();
                } else {
                    comp = calcularCompetencia(v);
                }
                compsAfetadas.add(comp);
                const item = await prisma.cartaoGasto.create({
                    data: {
                        cartao: d.cartao,
                        descricao: d.descricao,
                        categoria: d.categoria,
                        valor: valorParcela,
                        parcelaAtual: i,
                        totalParcelas: parcelas,
                        vencimento: v,
                        titular: d.titular,
                        competencia: comp,
                        simulada: d.simulada === true || d.simulada === 'SIM'
                    }
                });
                created.push(item);
            }
            for (const c of compsAfetadas) await consolidarFaturas(c);
            res.json(created[0]);
        }
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/login', async (req, res) => {
    try {
        const { usuario, senha } = req.body;
        const count = await prisma.usuario.count();
        if (count === 0) {
            await prisma.usuario.create({ data: { nome: "Pablo", senha: "123" } });
        }
        const userFound = await prisma.usuario.findUnique({ where: { nome: usuario } });
        if (userFound && userFound.senha === senha) {
            res.json({ sucesso: true, usuario: userFound.nome });
        } else {
            res.json({ sucesso: false, erro: "Usuário ou senha inválidos" });
        }
    } catch (error) { res.status(500).json({ error: error.message }); }
});

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
            let nome, foto, senha;
            if (Array.isArray(valor)) [nome, senha] = valor;
            else if (valor && typeof valor === 'object') ({ nome, foto, senha } = valor);
            else nome = valor;
            if (!nome) return res.status(400).json({ error: "Nome é obrigatório" });
            await prisma.usuario.upsert({
                where: { nome: String(nome) },
                update: { foto: foto || undefined, senha: senha || undefined },
                create: { nome: String(nome), senha: senha || '123', foto }
            });
        } else if (tipo === 'cartoes') {
            const [nome, titular, diaVencimento, diaFechamento] = valor;
            const data = { 
                nome: String(nome), titular: String(titular), 
                diaVencimento: Number(diaVencimento || 10), diaFechamento: Number(diaFechamento || 0) 
            };
            if (id) await prisma.cartaoConfig.update({ where: { id: Number(id) }, data });
            else await prisma.cartaoConfig.create({ data });
        } else if (tipo === 'categorias') {
            const nome = Array.isArray(valor) ? valor[0] : (valor && typeof valor === 'object' ? valor.nome : valor);
            const palavrasChave = Array.isArray(valor) ? valor[1] : (valor && typeof valor === 'object' ? valor.palavrasChave : "");
            if (!nome) return res.status(400).json({ error: "Nome é obrigatório" });
            await prisma.categoria.upsert({
                where: { nome: String(nome) },
                update: { palavrasChave: String(palavrasChave) },
                create: { nome: String(nome), palavrasChave: String(palavrasChave) }
            });
        }
        res.json({ sucesso: true });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.delete('/api/configs/:tipo', async (req, res) => {
    try {
        const { tipo } = req.params;
        const { id, valor } = req.body;
        if (id) {
             if (tipo === 'titulares') await prisma.usuario.delete({ where: { id: Number(id) } });
             else if (tipo === 'cartoes') await prisma.cartaoConfig.delete({ where: { id: Number(id) } });
             else if (tipo === 'categorias') await prisma.categoria.delete({ where: { id: Number(id) } });
        } else if (valor) {
             if (tipo === 'titulares') await prisma.usuario.delete({ where: { nome: valor } });
             else if (tipo === 'cartoes') {
                 const [n, t] = valor.split('|');
                 await prisma.cartaoConfig.deleteMany({ where: { nome: n, titular: t } });
             } else if (tipo === 'categorias') await prisma.categoria.delete({ where: { nome: valor } });
        }
        res.json({ sucesso: true });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

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

app.get('/api/notas', async (req, res) => {
    try {
        const nota = await prisma.nota.findUnique({ where: { id: 1 } });
        res.json({ nota: nota ? nota.texto : "" });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/limpar', async (req, res) => {
    try {
        const { tipo } = req.body;
        if (tipo === 'simulacoes') {
            await prisma.despesa.deleteMany({ where: { simulada: true } });
            await prisma.receita.deleteMany({ where: { simulada: true } });
            await prisma.cartaoGasto.deleteMany({ where: { simulada: true } });
        } else if (tipo === 'despesas') await prisma.despesa.deleteMany();
        else if (tipo === 'receitas') await prisma.receita.deleteMany();
        else if (tipo === 'cartoes') await prisma.cartaoGasto.deleteMany();
        res.json({ sucesso: true });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

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
        const id = Number(req.params.id);
        const item = await prisma.cartaoGasto.findUnique({ where: { id } });
        await prisma.cartaoGasto.delete({ where: { id } });
        if (item) await consolidarFaturas(item.competencia);
        res.json({ sucesso: true });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
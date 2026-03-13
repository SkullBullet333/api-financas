require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();

// Middlewares
app.use(cors()); // Libera o acesso de outras origens
app.use(express.json()); // Permite receber e processar dados JSON (como no seu antigo doPost)

// Rota de teste (Substitui o seu antigo doGet padrão)
app.get('/', (req, res) => {
    res.json({ status: "API online", message: "Sistema pronto para o Render!" });
});

// Inicia o servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});
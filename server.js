import { createApp } from './src/server.js';
const port = Number(process.env.PORT || 3000);
const app = createApp();
app.listen(port, () => console.log(`边城服饰数字展 http://localhost:${port}`));

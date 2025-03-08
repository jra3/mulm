import Koa from 'koa';
import Router from 'koa-router';
import views from 'koa-views';
import path from 'path';

const app = new Koa();
const router = new Router();

app.use(
    views(path.join(__dirname, 'views'), {
      extension: 'pug',
    })
  );

router.get('/', async (ctx) => {
  await ctx.render('index', { title: 'Home Page', message: 'Welcome to Koa with Pug!' });
});

router.get('/clicked', async (ctx) => {
  ctx.body = "Clicked";
});

app.use(router.routes()).use(router.allowedMethods());

const PORT = process.env.PORT || 4200;
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});

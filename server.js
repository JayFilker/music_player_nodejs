const express = require('express');
const cors = require('cors');
const axios = require('axios');
const app = express();
const port = 3000;

// 中间件：解析 JSON 请求体
app.use(express.json());

app.use(cors({
  origin: '*', // 更新为你实际使用的地址
  methods: ['GET', 'POST'],
  credentials: true
}));

// 静态文件服务
app.use(express.static('public'));

const querystring = require('querystring');
const { request } = require('axios')
const client_id = 'dfa7c80cf17f4170884a9576aa69a568'
const client_secret = '043d731cacfb40d6b6760bf4a83eb232'
const redirect_uri = 'https://music-player-rho-seven.vercel.app/callback'

const generateRandomString = function(length) {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

  for (let i = 0; i < length; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
};

// app.post('/api/exchange-token', async (req, res) => {
//   const { code } = req.body;
//   const state = req.query.state || null
//
//   if (state === null) {
//     res.redirect('/#' +
//       querystring.stringify({
//         error: 'state_mismatch'
//       }));
//   } else {
//     const authOptions = {
//       url: 'https://accounts.spotify.com/api/token',
//       form: {
//         code: code,
//         redirect_uri: redirect_uri,
//         grant_type: 'authorization_code',
//       },
//       headers: {
//         'content-type': 'application/x-www-form-urlencoded',
//         'Authorization': 'Basic ' +
//           (new Buffer.from(client_id + ':' + client_secret).toString('base64')),
//       },
//       json: true,
//     }
//   }
// });
app.post('/api/exchange-token', async (req, res) => {
  const { code } = req.body;

  if (!code) {
    return res.status(400).json({ error: 'Missing authorization code' });
  }

  try {
    // 准备请求 Spotify 交换令牌
    const tokenResponse = await axios({
      method: 'post',
      url: 'https://accounts.spotify.com/api/token',
      params: {
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: redirect_uri,
        client_id: client_id,
        client_secret: client_secret
      },
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    // 返回令牌给前端
    return res.json(tokenResponse.data);
  } catch (error) {
    console.error('Token exchange error:', error.response?.data || error.message);
    return res.status(200)
    // 会自动发送两次请求，为了防止报错关掉错误响应
    // res.status(500).json({
    //   error: 'Failed to exchange authorization code for tokens',
    //   details: error.response?.data || error.message
    // });
  }
});





app.get('/login', function(req, res) {

  const state = generateRandomString(16)
  const scope = 'streaming user-read-private user-read-email user-modify-playback-state user-read-playback-state'

  res.redirect('https://accounts.spotify.com/authorize?' +
    querystring.stringify({
      response_type: 'code',
      client_id: client_id,
      scope: scope,
      redirect_uri: redirect_uri,
      state: state
    }));
});

// Node.js + Express 示例
app.post('/api/refresh-token', async (req, res) => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    return res.status(400).json({ error: '需要刷新令牌' });
  }

  try {
    // 准备请求数据
    const params = new URLSearchParams();
    params.append('grant_type', 'refresh_token');
    params.append('refresh_token', refreshToken);

    // 发送请求到Spotify API
    const response = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${Buffer.from(`${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`).toString('base64')}`,
      },
      body: params,
    });

    if (!response.ok) {
      throw new Error('Spotify令牌刷新请求失败');
    }

    const data = await response.json();

    // 返回新的令牌
    res.json(data);
  } catch (error) {
    console.error('刷新令牌失败:', error);
    res.status(500).json({ error: '刷新令牌失败' });
  }
});

app.get('/refresh_token', async (req, res) => {
  try {
    const refresh_token = req.query.refresh_token;

    if (!refresh_token) {
      return res.status(400).json({ error: 'refresh_token is required' });
    }

    const response = await axios({
      method: 'post',
      url: 'https://accounts.spotify.com/api/token',
      params: {
        grant_type: 'refresh_token',
        refresh_token: refresh_token
      },
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Basic ' + Buffer.from(`${client_id}:${client_secret}`).toString('base64')
      }
    });

    const { access_token, refresh_token: new_refresh_token } = response.data;

    res.json({
      access_token,
      refresh_token: new_refresh_token || refresh_token
    });
  } catch (error) {
    console.error('Error refreshing token:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json(
      error.response?.data || { error: 'Failed to refresh token' }
    );
  }
});

// 启动服务器
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});

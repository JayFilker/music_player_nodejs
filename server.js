const express = require('express')
const cors = require('cors')
const axios = require('axios')
const app = express()
const { MongoClient } = require('mongodb');
const port = 3000

const qiniu = require('qiniu')
require('dotenv').config()

// 中间件：解析 JSON 请求体
app.use(express.json())

// app.use(cors({
//   origin: '*', // 更新为你实际使用的地址
//   methods: ['GET', 'POST', 'DELETE'],
//   credentials: false,
//   // credentials: true,
// }))

// 1. 更新 CORS 配置 - 这是最关键的部分
app.use(cors({
  origin: '*',  // 允许所有来源
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],  // 添加 OPTIONS
  credentials: false
}));

// 2. 添加简单的请求日志和手动 CORS 头 - 帮助调试
app.use((req, res, next) => {
  console.log(`${req.method} ${req.url} from ${req.headers.origin || 'unknown'}`);

  // 手动添加 CORS 头作为备份
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // 快速响应 OPTIONS 请求
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  next();
});

// 静态文件服务
app.use(express.static('public'))

const querystring = require('querystring')
const { request } = require('axios')
const client_id = 'dfa7c80cf17f4170884a9576aa69a568'
const client_secret = '043d731cacfb40d6b6760bf4a83eb232'
const redirect_uri = 'https://music-player-rho-seven.vercel.app/callback'
// const redirect_uri = 'http://127.0.0.1:5173/callback'

const generateRandomString = function(length) {
  let text = ''
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'

  for (let i = 0; i < length; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length))
  }
  return text
}
app.post('/api/exchange-token', async (req, res) => {
  const { code } = req.body

  if (!code) {
    return res.status(400).json({ error: 'Missing authorization code' })
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
        client_secret: client_secret,
      },
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    })

    // 返回令牌给前端
    return res.json(tokenResponse.data)
  } catch (error) {
    console.error('Token exchange error:',
      error.response?.data || error.message)
    return res.status(200)
    // 会自动发送两次请求，为了防止报错关掉错误响应
    // res.status(500).json({
    //   error: 'Failed to exchange authorization code for tokens',
    //   details: error.response?.data || error.message
    // });
  }
})

app.get('/login', function(req, res) {

  const state = generateRandomString(16)
  const scope = 'streaming user-read-private user-read-email user-modify-playback-state user-read-playback-state'

  res.redirect('https://accounts.spotify.com/authorize?' +
    querystring.stringify({
      response_type: 'code',
      client_id: client_id,
      scope: scope,
      redirect_uri: redirect_uri,
      state: state,
    }))
})

// Node.js + Express 示例
app.post('/api/refresh-token', async (req, res) => {
  const { refreshToken } = req.body

  if (!refreshToken) {
    return res.status(400).json({ error: '需要刷新令牌' })
  }

  try {
    // 准备请求数据
    const params = new URLSearchParams()
    params.append('grant_type', 'refresh_token')
    params.append('refresh_token', refreshToken)

    // 发送请求到Spotify API
    const response = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${ Buffer.from(
          `${ process.env.SPOTIFY_CLIENT_ID }:${ process.env.SPOTIFY_CLIENT_SECRET }`).
          toString('base64') }`,
      },
      body: params,
    })

    if (!response.ok) {
      throw new Error('Spotify令牌刷新请求失败')
    }

    const data = await response.json()

    // 返回新的令牌
    res.json(data)
  } catch (error) {
    console.error('刷新令牌失败:', error)
    res.status(500).json({ error: '刷新令牌失败' })
  }
})

app.get('/refresh_token', async (req, res) => {
  try {
    const refresh_token = req.query.refresh_token

    if (!refresh_token) {
      return res.status(400).json({ error: 'refresh_token is required' })
    }

    const response = await axios({
      method: 'post',
      url: 'https://accounts.spotify.com/api/token',
      params: {
        grant_type: 'refresh_token',
        refresh_token: refresh_token,
      },
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Basic ' +
          Buffer.from(`${ client_id }:${ client_secret }`).toString('base64'),
      },
    })

    const {
      access_token,
      refresh_token: new_refresh_token,
    } = response.data

    res.json({
      access_token,
      refresh_token: new_refresh_token || refresh_token,
    })
  } catch (error) {
    console.error('Error refreshing token:',
      error.response?.data || error.message)
    res.status(error.response?.status || 500).json(
      error.response?.data || { error: 'Failed to refresh token' },
    )
  }
})

// 七牛云配置
const qiniuConfig = {
  accessKey: process.env.QINIU_ACCESS_KEY,
  secretKey: process.env.QINIU_SECRET_KEY,
  bucket: process.env.QINIU_BUCKET,
  domain: process.env.QINIU_DOMAIN, // 例如: http://example.bkt.clouddn.com
}

// 获取视频列表
app.get('/api/videos', async (req, res) => {
  try {
    const mac = new qiniu.auth.digest.Mac(qiniuConfig.accessKey,
      qiniuConfig.secretKey)
    const config = new qiniu.conf.Config()
    // 空间对应的机房，如果是华东区可以不指定
    config.zone = qiniu.zone.Zone_z0

    const bucketManager = new qiniu.rs.BucketManager(mac, config)

    // 列出存储空间中的视频文件
    bucketManager.listPrefix(qiniuConfig.bucket, {
      prefix: 'movie/', // 指定前缀，可选
      limit: 100,         // 单次列举的条目数
    }, (err, respBody, respInfo) => {
      if (err) {
        console.error(err)
        return res.status(500).json({ error: '获取视频列表失败' })
      }

      if (respInfo.statusCode === 200) {
        // 只返回视频文件（可根据文件后缀过滤）
        const videoFiles = respBody.items.filter(item =>
          item.key.endsWith('.mp4') ||
          item.key.endsWith('.webm') ||
          item.key.endsWith('.mov'),
        ).map(item => {
          const videoUrl = `${ qiniuConfig.domain }/${ item.key }`
          const fileName = item.key.split('/').pop().replace(/\.[^/.]+$/, '')
          return {
            key: item.key,
            size: item.fsize,
            mimeType: item.mimeType,
            updatedAt: item.putTime,
            videoUrl: videoUrl,
            title: item.key.split('/').pop().replace(/\.[^/.]+$/, ''),// 提取文件名作为标题
            img: `${qiniuConfig.domain}/${item.key}?vframe/jpg/offset/1/w/320/h/180&t=${Date.now()}`,
          }
        })

        return res.json({ videos: videoFiles })
      } else {
        console.error('获取视频列表失败', respInfo.statusCode, respBody)
        return res.status(respInfo.statusCode).
          json({ error: '获取视频列表失败' })
      }
    })
  } catch (error) {
    console.error('服务器错误', error)
    res.status(500).json({ error: '服务器错误' })
  }
})
// 获取图片列表
app.get('/api/imgs', async (req, res) => {
  try {
    const mac = new qiniu.auth.digest.Mac(qiniuConfig.accessKey,
      qiniuConfig.secretKey)
    const config = new qiniu.conf.Config()
    // 空间对应的机房，如果是华东区可以不指定
    config.zone = qiniu.zone.Zone_z0

    const bucketManager = new qiniu.rs.BucketManager(mac, config)

    // 列出存储空间中的视频文件
    bucketManager.listPrefix(qiniuConfig.bucket, {
      prefix: 'img/', // 指定前缀，可选
      limit: 100,         // 单次列举的条目数
    }, (err, respBody, respInfo) => {
      if (err) {
        console.error(err)
        return res.status(500).json({ error: '获取视频列表失败' })
      }

      if (respInfo.statusCode === 200) {
        // 只返回视频文件（可根据文件后缀过滤）
        const videoFiles = respBody.items.filter(item =>
          item.key.endsWith('.jpg')
        ).map(item => {
          const videoUrl = `${ qiniuConfig.domain }/${ item.key }`
          const fileName = item.key.split('/').pop().replace(/\.[^/.]+$/, '')
          return {
            videoUrl: videoUrl,
            title: item.key.split('/').pop().replace(/\.[^/.]+$/, ''),// 提取文件名作为标题
          }
        })

        return res.json({ videos: videoFiles })
      } else {
        console.error('获取视频列表失败', respInfo.statusCode, respBody)
        return res.status(respInfo.statusCode).
          json({ error: '获取视频列表失败' })
      }
    })
  } catch (error) {
    console.error('服务器错误', error)
    res.status(500).json({ error: '服务器错误' })
  }
})

// 获取视频信息
app.get('/api/videos/info', (req, res) => {
  try {
    // const { key } = req.params
    const { key } = req.query;
    const mac = new qiniu.auth.digest.Mac(qiniuConfig.accessKey,
      qiniuConfig.secretKey)
    const config = new qiniu.conf.Config()
    const bucketManager = new qiniu.rs.BucketManager(mac, config)

    bucketManager.stat(qiniuConfig.bucket, key, (err, respBody, respInfo) => {
      if (err) {
        console.error(err)
        return res.status(500).json({ error: '获取视频信息失败' })
      }

      if (respInfo.statusCode === 200) {
        return res.json(respBody)
      } else {
        return res.status(respInfo.statusCode).
          json({ error: '获取视频信息失败' })
      }
    })
  } catch (error) {
    console.error('服务器错误', error)
    res.status(500).json({ error: '服务器错误' })
  }
})

const MongDBUrl='mongodb+srv://18050939892:deerkesi3815@blog.ssrtblo.mongodb.net/blogBatabase?retryWrites=true&w=majority&appName=blog'
app.post('/addLikeSong', async (req, res) => {
  const MONGODB_URI = MongDBUrl;
  const newComment = req.body;
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const database = client.db("music-player");
  const songs = database.collection("music-player-demo");
  const commentWithDate = {
    ...newComment,
  };

  // 添加新评论
  await songs.insertOne(commentWithDate);
  return res.status(200).json({
    success: true,
    message: "更新成功",
  });
});

app.post('/removeLikeSong', async (req, res) => {
  const MONGODB_URI = MongDBUrl;
  const songData = req.body;
  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    const database = client.db("music-player");
    const songs = database.collection("music-player-demo");

    // 删除name匹配的记录
    const result = await songs.deleteOne({ name: songData.name });

    if (result.deletedCount === 1) {
      return res.status(200).json({
        success: true,
        message: "删除成功"
      });
    } else {
      return res.status(404).json({
        success: false,
        message: "未找到要删除的歌曲"
      });
    }
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "删除失败",
      error: error.message
    });
  } finally {
    await client.close();
  }
});


app.get('/mySongs', async (req, res) => {
  const client = new MongoClient(MongDBUrl);
  await client.connect();
  const database = client.db("music-player");
  const songs = database.collection("music-player-demo");

  const allBlogs = await songs.find({}).toArray();

  return res.status(200).json({
    success: true,
    message: "获取所有收藏的音乐成功",
    songs: allBlogs
  });
});

app.get('/songs', async (req, res) => {
  return res.status(200).json({
    success: true,
    message: "获取所有收藏的音乐成功",
    songs: 666
  })
})

// 启动服务器
app.listen(port, () => {
  console.log(`Server running at http://localhost:${ port }`)
})

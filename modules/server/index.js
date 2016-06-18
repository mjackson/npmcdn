/*eslint-disable no-console*/
import http from 'http'
import path from 'path'
import cors from 'cors'
import throng from 'throng'
import morgan from 'morgan'
import express from 'express'
import devErrorHandler from 'errorhandler'
import WebpackDevServer from 'webpack-dev-server'
import { createRequestHandler } from 'npm-http-server'
import { staticAssets, devAssets, createDevCompiler } from './AssetsUtils'
import webpackConfig from '../../webpack.config'
import { sendHomePage } from './MainController'
import { logStats } from './StatsUtils'

export const createRouter = (config = {}) => {
  const router = express.Router()

  router.get('/', sendHomePage)

  if (config.redisURL)
    router.use(logStats(config.redisURL))

  router.use(createRequestHandler(config))

  return router
}

const errorHandler = (err, req, res, next) => {
  res.status(500).send('<p>Internal Server Error</p>')
  console.error(err.stack)
  next(err)
}

export const createServer = (config) => {
  const app = express()

  app.disable('x-powered-by')
  app.use(errorHandler)
  app.use(cors())
  app.use(express.static(config.publicDir, { maxAge: 60000 }))
  app.use(staticAssets(config.statsFile))
  app.use(createRouter(config))

  const server = http.createServer(app)

  // Heroku dynos automatically timeout after 30s. Set our
  // own timeout here to force sockets to close before that.
  // https://devcenter.heroku.com/articles/request-timeout
  if (config.timeout) {
    server.setTimeout(config.timeout, (socket) => {
      const message = `Server timeout of ${config.timeout}ms exceeded`
      const httpMessage = [
        `HTTP/1.1 503 Service Unavailable`,
        `Date: ${(new Date).toGMTString()}`,
        `Content-Type: text/plain`,
        `Content-Length: ${message.length}`,
        `Connection: close`,
        ``,
        message
      ].join(`\r\n`)

      socket.end(httpMessage)
    })
  }

  return server
}

export const createDevServer = (config) => {
  const webpackConfig = config.webpackConfig
  const compiler = createDevCompiler(
    webpackConfig,
    `webpack-dev-server/client?http://localhost:${config.port}`
  )

  const server = new WebpackDevServer(compiler, {
    // webpack-dev-middleware options.
    publicPath: webpackConfig.output.publicPath,
    quiet: false,
    noInfo: false,
    stats: {
      // https://webpack.github.io/docs/node.js-api.html#stats-tojson
      assets: true,
      colors: true,
      version: true,
      hash: true,
      timings: true,
      chunks: false
    },

    // webpack-dev-server options.
    contentBase: false,
    setup(app) {
      // This runs before webpack-dev-middleware.
      app.disable('x-powered-by')
      app.use(morgan('dev'))
    }
  })

  // This runs after webpack-dev-middleware.
  server.use(devErrorHandler())
  server.use(express.static(config.publicDir))
  server.use(devAssets(compiler))
  server.use(createRouter(config))

  return server
}

const port = process.env.PORT || 5000
const statsFile = path.resolve(__dirname, '../../stats.json')
const publicDir = path.resolve(__dirname, '../../public')
const registryURL = process.env.REGISTRY_URL || 'https://registry.npmjs.org'
const bowerBundle = process.env.BOWER_BUNDLE || '/bower.zip'
const redirectTTL = process.env.REDIRECT_TTL || 500
const autoIndex = !process.env.DISABLE_INDEX
const redisURL = process.env.REDIS_URL
const timeout = 20000

const DefaultServerConfig = {
  id: 1,
  port,
  webpackConfig,
  statsFile,
  publicDir,
  registryURL,
  bowerBundle,
  redirectTTL,
  autoIndex,
  redisURL,
  timeout
}

export const startServer = (serverConfig) => {
  const config = {
    ...DefaultServerConfig,
    ...serverConfig
  }

  const server = process.env.NODE_ENV === 'production'
    ? createServer(config)
    : createDevServer(config)

  server.listen(config.port, () => {
    console.log('Server #%s listening on port %s, Ctrl+C to stop', config.id, config.port)
  })
}

if (require.main === module)
  throng({
    start: (id) => startServer({ id }),
    workers: process.env.WEB_CONCURRENCY || 1,
    lifetime: Infinity
  })
'use strict';
var P = require('bluebird')
var bodyParser = require('body-parser')
var Busboy = require('busboy')
var express = require('express')
var fs = require('graceful-fs')
var https = require('https')
var mime = require('mime')
var request = require('request')
var sha1stream = require('sha1-stream')
var temp = require('temp')

var app = express()
var content = require('./helpers/content')
var contentExists = require('./helpers/contentExists')
var job = require('./helpers/job')
var NetworkError = require('../helpers/NetworkError')
var pkg = require('../package.json')
var promisePipe = require('../helpers/promisePipe')
var purchase = require('./helpers/purchase')
var sslOptions = {
  keyFile: __dirname + '/../ssl/stretchfs_test.key',
  certFile: __dirname + '/../ssl/stretchfs_test.crt',
  pemFile: __dirname + '/../ssl/stretchfs_test.pem',
  key: fs.readFileSync(__dirname + '/../ssl/stretchfs_test.key'),
  cert: fs.readFileSync(__dirname + '/../ssl/stretchfs_test.crt'),
  pem: fs.readFileSync(__dirname + '/../ssl/stretchfs_test.pem')
}
var server = https.createServer(
  {
    cert: sslOptions.pem,
    key: sslOptions.pem
  },
  app
)
var user = require('./helpers/user')
var UserError = require('../helpers/UserError')

//make some promises
P.promisifyAll(fs)
P.promisifyAll(server)

//setup
app.use(bodyParser.json())


//--------------------
//public routes
//--------------------

//home page
app.post('/',function(req,res){
  res.json({message: 'Welcome to StretchFS Mock version ' + pkg.version})
})

//health test
app.post('/ping',function(req,res){
  res.json({pong: 'pong'})
})

//--------------------
//protected routes
//--------------------
var validateSession = function(req,res,next){
  var token = req.get('X-StretchFS-Token')
  if(!token || user.session.token !== token){
    res.status(401)
    res.json({error: 'Invalid session'})
  } else {
    req.session = user.session
    next()
  }
}

//user functions
app.post('/user/login',function(req,res){
  P.try(function(){
    if(!req.body.username || 'test' !== req.body.username)
      throw new UserError('No user found')
    if(!req.body.password || user.password !== req.body.password)
      throw new UserError('Invalid password')
    res.json({
      success: 'User logged in',
      session: user.session
    })
  })
    .catch(UserError,function(err){
      res.json({error: err.message})
    })
})

app.post('/user/logout',validateSession,function(req,res){
  res.json({success: 'User logged out'})
})
app.post('/user/session/validate',validateSession,function(req,res){
  res.json({success: 'Session Valid'})
})

//content functions
app.post('/content/detail',validateSession,function(req,res){
  var detail = contentExists
  detail.hash = req.body.hash || req.body.sha1
  detail.sha1 = req.body.hash || req.body.sha1
  res.json(detail)
})
app.post('/content/upload',validateSession,function(req,res){
  var data = {}
  var files = {}
  var filePromises = []
  var busboy = new Busboy({
    headers: req.headers,
    highWaterMark: 65536, //64K
    limits: {
      fileSize: 2147483648000 //2TB
    }
  })
  busboy.on('field',function(key,value){
    data[key] = value
  })
  busboy.on('file',function(key,file,name,encoding,mimetype){
    var tmpfile = temp.path({prefix: 'stretchfs-mock-'})
    var sniff = sha1stream.createStream()
    var writeStream = fs.createWriteStream(tmpfile)
    files[key] = {
      key: key,
      tmpfile: tmpfile,
      name: name,
      encoding: encoding,
      mimetype: mimetype,
      ext: mime.getExtension(mimetype),
      hash: null
    }
    filePromises.push(
      promisePipe(file,sniff,writeStream)
        .then(function(){
          files[key].hash = sniff.hash
        })
    )
  })
  busboy.on('finish',function(){
    P.all(filePromises)
      //destroy all the temp files from uploading
      .then(function(){
        var keys = Object.keys(files)
        var promises = []
        var file
        for(var i = 0; i < keys.length; i++){
          file = files[keys[i]]
          promises.push(fs.unlinkAsync(file.tmpfile))
        }
        return P.all(promises)
      })
      .then(function(){
        res.json({success: 'File(s) uploaded',data: data,files: files})
      })
      .catch(UserError,function(err){
        res.json({error: err.message})
      })
  })
  req.pipe(busboy)
})
app.post('/content/retrieve',validateSession,function(req,res){
  var retrieveRequest = req.body.request
  var extension = req.body.extension || 'bin'
  var sniff = sha1stream.createStream()
  var hash
  P.try(function(){
    return promisePipe(request(retrieveRequest),sniff)
      .then(
      function(val){return val},
      function(err){throw new UserError(err.message)}
    )
  })
    .then(function(){
      hash = sniff.hash
      res.json({
        hash: hash,
        extension: extension
      })
    })
    .catch(NetworkError,function(err){
      res.status(500)
      res.json({
        error: 'Failed to check content existence: ' + err.message
      })
    })
})
app.post('/content/purchase',validateSession,function(req,res){
  var hash = req.body.hash || req.body.sha1
  var ext = req.body.ext
  var referrer = req.body.referrer
  var life = req.body.life
  if(!hash){
    res.json({error: 'No SHA1 passed for purchase'})
  }
  var detail = purchase
  detail.life = life || detail.life
  detail.referrer = referrer || detail.referrer
  detail.hash = hash
  detail.sha1 = hash
  detail.ext = ext
  res.json(detail)
})
app.post('/content/purchase/remove',validateSession,function(req,res){
  var token = req.body.token
  res.json({token: token, count: 1, success: 'Purchase removed'})
})

//job functions
app.post('/job/create',validateSession,function(req,res){
  var data = req.body
  res.json({
    handle: job.handle,
    description: data.description,
    priority: data.priority,
    category: data.category || 'resource',
    UserId: job.UserId
  })
})
app.post('/job/detail',validateSession,function(req,res){
  res.json({
    handle: job.handle,
    description: job.description,
    priority: job.priority,
    category: job.category,
    status: job.status,
    statusDescription: job.statusDescription,
    stepTotal: job.stepTotal,
    stepComplete: job.stepComplete,
    frameTotal: job.frameTotal,
    frameComplete: job.frameComplete,
    frameDescription: job.frameDescription,
    UserId: job.UserId
  })
})
app.post('/job/update',validateSession,function(req,res){
  var data = req.body
  res.json({
    handle: data.handle || job.handle,
    description: data.description || job.description,
    priority: data.priority || job.priority,
    category: data.category || job.category,
    status: data.status || job.status,
    statusDescription: data.statusDescription || job.statusDescription,
    stepTotal: data.stepTotal || job.stepTotal,
    stepComplete: data.stepComplete || job.stepComplete,
    frameTotal: data.frameTotal || job.frameTotal,
    frameComplete: data.frameComplete || job.frameComplete,
    frameDescription: data.frameDescription || job.frameDescription,
    UserId: data.UserId || job.UserId
  })
})
app.post('/job/remove',validateSession,function(req,res){
  res.json({
    success: 'Job removed',
    count: 1
  })
})
app.post('/job/start',validateSession,function(req,res){
  var jobStart = job
  jobStart.status = 'queued'
  res.json(jobStart)
})
app.post('/job/retry',validateSession,function(req,res){
  var jobRetry = job
  jobRetry.status = 'queued_retry'
  res.json(jobRetry)
})
app.post('/job/abort',validateSession,function(req,res){
  var jobAbort = job
  jobAbort.status = 'queued_abort'
  res.json(jobAbort)
})
app.post('/job/content/exists',validateSession,function(req,res){
  res.json({
    exists: false
  })
})
app.get('/job/content/download/:handle/:file',function(req,res){
  res.type('text/plain')
  res.send('foo\n')
})

//main content retrieval route
app.get('/:token/:filename',function(req,res){
  res.redirect(302,
    'http://mock.stretchfs.com/' + purchase.token + '/' + req.params.filename)
})


/**
 * Mock content record
 * @type {object}
 */
exports.content = content


/**
 * Mock content exists
 * @type {object}
 */
exports.contentExists = contentExists


/**
 * Mock job
 * @type {object}
 */
exports.job = job


/**
 * Mock SSL certificate
 * @type {object}
 */
exports.sslOptions = sslOptions


/**
 * Mock purchase
 * @type {object}
 */
exports.purchase = purchase


/**
 * Mock user and session
 * @type {object}
 */
exports.user = user


/**
 * Start stretchfs mock
 * @param {number} port
 * @param {string} host
 * @return {P}
 */
exports.start = function(port,host){
  return server.listenAsync(+port,host)
}


/**
 * Stop stretchfs prism
 * @return {P}
 */
exports.stop = function(){
  return server.closeAsync()
}

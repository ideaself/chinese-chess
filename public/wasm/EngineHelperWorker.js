/**
 * Pikafish 引擎 Worker
 *
 * pikafish.js 是 Emscripten CommonJS 构建，顶部引用 require('fs') 与 __dirname，
 * 必须在 importScripts 之前注入浏览器 shim（与主线程版一致）。
 *
 * 消息协议:
 *   主线程 → Worker: { wasm_type, origin } 初始化 | { command } UCI 命令
 *   Worker → 主线程: { ready } 就绪 | { stdout } 引擎输出 | { download } 进度 | { error } 错误
 */
(function () {
  var engine = null
  var DEBUG = false

  function injectShims() {
    var shimFs = {
      readFile: function (path, cb) {
        fetch(path)
          .then(function (r) {
            if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + path)
            return r.arrayBuffer()
          })
          .then(function (ab) {
            // Emscripten 的 fetchRemotePackage 期望 Buffer/TypedArray（会访问 .buffer/.byteOffset）
            if (cb) cb(null, new Uint8Array(ab))
          })
          .catch(function (e) { if (cb) cb(e) })
      },
      readFileSync: function (path) {
        var xhr = new XMLHttpRequest()
        xhr.open('GET', path, false)
        xhr.responseType = 'arraybuffer'
        xhr.send()
        if (xhr.status !== 200) throw new Error('HTTP ' + xhr.status + ' ' + path)
        return xhr.response
      },
      writeFileSync: function () {},
      existsSync: function () { return false },
      read: function () { return 0 },
      write: function () {},
      stat: function () { return { size: 0 } },
      open: function () {},
      close: function () {},
      mkdir: function () {},
      readdir: function () {},
      unlink: function () {},
      rename: function () {},
      rmdir: function () {},
      access: function () {},
      constants: { O_RDONLY: 0, O_WRONLY: 1, O_RDWR: 2 },
    }

    self.require = function (id) {
      if (id === 'fs') return shimFs
      if (id === 'path') return { join: function () { return Array.prototype.join.call(arguments, '/') }, resolve: function () { return Array.prototype.join.call(arguments, '/') } }
      if (id === 'module') return { exports: {} }
      return {}
    }
    self.module = { exports: {} }
    self.exports = {}
    // Emscripten 单文件构建顶部引用 __dirname
    self.__dirname = '/wasm/single'
  }

  function fail(message) {
    self.postMessage({ error: message })
  }

  /** 例行诊断日志：仅调试模式发送 */
  function dbg(message) {
    if (DEBUG) self.postMessage({ log: message })
  }

  self.onmessage = function (e) {
    var msg = e.data || {}

    // 转发 UCI 命令
    if (msg.command != null) {
      if (!engine) { fail('引擎尚未就绪'); return }
      try { engine.send_command(msg.command) } catch (err) { fail('send_command: ' + (err && err.message)) }
      return
    }

    // 初始化引擎
    if (msg.wasm_type != null) {
      var type = msg.wasm_type
      var origin = msg.origin || ''
      DEBUG = !!msg.debug
      try {
        injectShims()
        dbg('shims 注入完成')
        self.importScripts(origin + '/wasm/' + type + '/pikafish.js')
        dbg('pikafish.js 已加载')

        var Pikafish = self.Pikafish || (self.module && self.module.exports)
        if (typeof Pikafish !== 'function') throw new Error('Pikafish 全局变量未定义')
        dbg('工厂函数就绪，开始实例化')

        Pikafish({
          locateFile: function (file) {
            if (file === 'pikafish.data') return origin + '/wasm/data/' + file
            return origin + '/wasm/' + type + '/' + file
          },
          print: function () {},
          printErr: function (text) { dbg('stderr: ' + text) },
          setStatus: function (status) {
            if (DEBUG && status) dbg('status: ' + status)
          },
        }).then(function (inst) {
          engine = inst
          inst.read_stdout = function (stdout) {
            self.postMessage({ stdout: stdout })
          }
          dbg('实例化完成')
          self.postMessage({ ready: true })
        }).catch(function (err) {
          fail('实例化失败: ' + (err && err.message ? err.message : err))
        })
      } catch (err) {
        fail('加载失败: ' + (err && err.message ? err.message : err))
      }
    }
  }
})()

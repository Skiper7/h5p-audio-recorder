import RecorderWorker from './RecorderWorker'

const RecorderState = {
  inactive: 'inactive',
  recording: 'recording'
};

const errorMessageToCodeMap = {
  PermissionDeniedError: 'permission-denied',
  NotAllowedError: 'permission-denied'
};

/**
 * Event triggered when recorder goes from recording to inactive
 *
 * @event Recorder#inactive
 * @type {Object}
 */

/**
 * Event triggered when recording is started
 *
 * @event Recorder#recording
 * @type {Object}
 */

/**
 * Event triggered when microphone access is denied
 *
 * @event Recorder#blocked
 * @type {Object}
 */

/**
 * The recorder class
 *
 * @fires Recorder#inactive
 * @fires Recorder#recording
 * @fires Recorder#blocked
 */
export default class Recorder extends H5P.EventDispatcher{

  /**
   * @constructor
   */
  constructor() {
    super();

    this.config = {
      bufferLength: 4096,
      numChannels: 1
    }

    this.state = RecorderState.inactive;

    // Create a worker. This is normally done using a URL to the js-file
    const workerBlob = new Blob(
      [RecorderWorker.toString().replace(/^function .+\{?|\}$/g, '')],
      {type:'text/javascript'}
    );
    const workerBlobUrl = URL.createObjectURL(workerBlob);
    this.worker = new Worker(workerBlobUrl);

    const self = this;
    this.worker.onmessage = function (e) {
      self.trigger(e.data.command, e.data.blob);
    };

    this.init();
  }

  /**
   * Creates a URL to a wav blob
   *
   * @return {Promise}
   */
  getWavURL() {
    this.stop();

    const promise = new Promise((resolve, reject) => {
      this.once('wav-delivered', (e) => {
        resolve(URL.createObjectURL(e.data));
      });
    });

    this.worker.postMessage({
      command: 'export-wav'
    });

    return promise;
  }

  /**
   * Initialize
   */
  init() {
    const self = this;

    if (!this.supported()) {
      return;
    }

    this.audioContext = new AudioContext();
    this.scriptProcessorNode = this.audioContext.createScriptProcessor(
      this.config.bufferLength,
      this.config.numChannels,
      this.config.numChannels);

    this.scriptProcessorNode.onaudioprocess = function(e) {
      if (self.state === RecorderState.recording) {
        self.worker.postMessage({
          command: 'record',
          buffer: [e.inputBuffer.getChannelData(0)]
        });
      }
    };
  }

  /**
   * Grab the mic
   *
   * @return {Promise}
   */
  grabMic() {
    if (this.userMedia === undefined) {
      const self = this;
      this.userMedia = new Promise((resolve, reject) => {
        navigator.mediaDevices.getUserMedia({audio: true}).then((stream) => {
          self.stream = stream;
          this.sourceNode = this.audioContext.createMediaStreamSource(stream);
          this.sourceNode.connect(this.scriptProcessorNode);
          this.scriptProcessorNode.connect(this.audioContext.destination);

          this.worker.postMessage({
            command: 'init',
            config: {
              sampleRate: this.sourceNode.context.sampleRate,
              numChannels: this.config.numChannels
            }
          });

          resolve();
        }).catch((e) => {
          reject({
            code: this._errorToCode(e),
            error: e
          });
        });
      });
    }

    return this.userMedia;
  }

  /**
   * Start or resume a recording
   */
  start() {
    this.grabMic()
      .then(() => {
        this._setState(RecorderState.recording);
      })
      .catch((e) => {
        this.trigger('blocked');
      });
  }

  /**
   * Stop/pause a recording
   */
  stop() {
    this._setState(RecorderState.inactive);
  }

  /**
   * Check if browser supports recording
   * @return {boolean}
   */
  supported() {
    return window.AudioContext !== undefined &&
           navigator.mediaDevices &&
           navigator.mediaDevices.getUserMedia;
  }

  /**
   * Reset previous recording
   */
  reset() {
    this._setState(RecorderState.inactive);
    this.worker.postMessage({
      command: 'clear'
    });
  }

  /**
   * Maps different browsers error codes to a common one
   *
   * @param {Object} e Error object from browser
   * @private
   * @return {string}
   */
  _errorToCode(e) {
    if (e.name && errorMessageToCodeMap[e.name]) {
      return errorMessageToCodeMap[e.name];
    }
    return 'unknown';
  }

  /**
   * Set state
   *
   * @private
   * @param {string} state
   */
  _setState(state) {
    this.state = state;
    this.trigger(this.state);
  }
}

const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
ffmpeg.setFfmpegPath(ffmpegPath);

let teeOutputs = `[f=flv]rtmps://live-api-s.facebook.com:443/rtmp//FB-122170793498306800-0-Ab6EIf6mc8MV1Y0-tkodGG2H`;

ffmpeg()
    .input('audio=CABLE Output (VB-Audio Virtual Cable)')
    .inputFormat('dshow')
    .outputOptions('-t 1')
    .output(teeOutputs)
    .outputFormat('tee')
    .on('start', cmd => console.log('COMMAND:', cmd))
    .on('error', err => console.log('ERROR:', err.message))
    .on('end', () => console.log('SUCCESS'))
    .run();

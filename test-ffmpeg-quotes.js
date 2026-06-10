const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
ffmpeg.setFfmpegPath(ffmpegPath);

ffmpeg()
    .input('audio="CABLE Output (VB-Audio Virtual Cable)"')
    .inputFormat('dshow')
    .outputOptions('-t 1')
    .output('NUL')
    .outputFormat('null')
    .on('error', err => console.log('ERROR:', err.message))
    .on('end', () => console.log('SUCCESS'))
    .run();

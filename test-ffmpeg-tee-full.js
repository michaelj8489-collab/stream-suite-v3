const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
ffmpeg.setFfmpegPath(ffmpegPath);

let teeOutputs = `[f=flv]rtmp://live.restream.io/live/dummy|[f=flv]rtmps://live-api-s.facebook.com:443/rtmp//dummy`;

ffmpeg()
    .input('testsrc=duration=1:size=1280x720:rate=30')
    .inputFormat('lavfi')
    .input('anullsrc=r=44100:cl=stereo')
    .inputFormat('lavfi')
    .videoCodec('libx264')
    .audioCodec('aac')
    .outputOptions([
        '-preset ultrafast', 
        '-tune zerolatency', 
        '-s 1280x720', 
        '-b:v 2500k', 
        '-b:a 128k', 
        '-pix_fmt yuv420p',
        '-map 0:v',
        '-map 1:a'
    ])
    .output(teeOutputs)
    .outputFormat('tee')
    .output('NUL')
    .outputFormat('mp4')
    .on('start', cmd => console.log('COMMAND:', cmd))
    .on('error', err => console.log('ERROR:', err.message))
    .on('end', () => console.log('SUCCESS'))
    .run();

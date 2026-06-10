const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
ffmpeg.setFfmpegPath(ffmpegPath);

let teeOutputs = `[f=flv]rtmp://live.restream.io/live/dummy|[f=flv]rtmps://live-api-s.facebook.com:443/rtmp//dummy`;

ffmpeg()
    .input('testsrc=duration=1:size=1280x720:rate=30')
    .inputFormat('lavfi')
    .input('anullsrc=r=44100:cl=stereo')
    .inputFormat('lavfi')
    .outputOptions([
        '-map 0:v',
        '-map 1:a',
        '-vcodec libx264',
        '-acodec aac',
        '-preset ultrafast', 
        '-tune zerolatency', 
        '-s 1280x720', 
        '-b:v 2500k', 
        '-b:a 128k', 
        '-pix_fmt yuv420p'
    ])
    .output(teeOutputs)
    .outputFormat('tee')
    
    .outputOptions([
        '-map 0:v',
        '-map 1:a',
        '-vcodec libx264',
        '-acodec aac',
        '-preset ultrafast', 
        '-tune zerolatency', 
        '-s 1280x720', 
        '-b:v 2500k', 
        '-b:a 128k', 
        '-pix_fmt yuv420p'
    ])
    .output('NUL')
    .outputFormat('mp4')
    
    .outputOptions(['-map 1:a', '-acodec libmp3lame'])
    .output('NUL')
    .outputFormat('mp3')
    
    .on('start', cmd => console.log('COMMAND:', cmd))
    .on('error', err => console.log('ERROR:', err.message))
    .on('end', () => console.log('SUCCESS'))
    .run();

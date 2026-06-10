const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
ffmpeg.setFfmpegPath(ffmpegPath);

ffmpeg()
    .input('testsrc=duration=1:size=1280x720:rate=30')
    .inputFormat('lavfi')
    .input('anullsrc=r=44100:cl=stereo')
    .inputFormat('lavfi')
    .complexFilter([
        '[0:v]split=2[v1][v2]',
        '[1:a]asplit=4[a1][a2][a3][a4]'
    ])
    .output('rtmp://live.restream.io/live/dummy')
    .outputFormat('flv')
    .outputOptions([
        '-map [v1]',
        '-map [a1]',
        '-vcodec libx264',
        '-acodec aac',
        '-preset ultrafast',
        '-tune zerolatency',
        '-s 1280x720',
        '-b:v 2500k',
        '-b:a 128k'
    ])
    
    .output('video.mp4')
    .outputFormat('mp4')
    .outputOptions([
        '-map [v2]',
        '-map [a2]',
        '-vcodec libx264',
        '-acodec aac',
        '-preset ultrafast',
        '-tune zerolatency',
        '-s 1280x720',
        '-b:v 2500k',
        '-b:a 128k'
    ])
    
    .output('icecast.mp3')
    .outputFormat('mp3')
    .outputOptions([
        '-map [a3]',
        '-acodec libmp3lame',
        '-b:a 128k'
    ])
    
    .output('audio.mp3')
    .outputFormat('mp3')
    .outputOptions([
        '-map [a4]',
        '-acodec libmp3lame',
        '-b:a 128k'
    ])
    
    .on('start', cmd => console.log('COMMAND:', cmd))
    .on('error', err => console.log('ERROR:', err.message))
    .on('end', () => console.log('SUCCESS'))
    .run();

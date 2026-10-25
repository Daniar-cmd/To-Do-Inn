const { src, dest, watch, series } = require('gulp');
const sass = require('gulp-sass')(require('sass'));

function styles() {
  return src('src/scss/style.scss')
    .pipe(sass().on('error', sass.logError))
    .pipe(dest('public/css'));
}

function buildStyles() {
  return src('src/scss/style.scss')
    .pipe(sass({ style: 'compressed' }).on('error', sass.logError))
    .pipe(dest('public/css'));
}

exports.dev = series(styles, function watchStyles() {
  return watch('src/scss/**/*.scss', styles);
});
exports.build = buildStyles;

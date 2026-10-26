const { src, dest, watch, series } = require('gulp');
const sass = require('gulp-sass')(require('sass'));

function styles() {
  return src('frontend/scss/style.scss')
    .pipe(sass().on('error', sass.logError))
    .pipe(dest('frontend/css'));
}

function buildStyles() {
  return src('frontend/scss/style.scss')
    .pipe(sass({ style: 'compressed' }).on('error', sass.logError))
    .pipe(dest('frontend/css'));
}

exports.dev = series(styles, function watchStyles() {
  return watch('frontend/scss/**/*.scss', styles);
});
exports.build = buildStyles;

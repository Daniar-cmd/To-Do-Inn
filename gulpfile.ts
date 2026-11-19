import { src, dest, watch, series } from 'gulp';
import gulpSass from 'gulp-sass';
import * as dartSass from 'sass';

const sass = gulpSass(dartSass);

function styles() {
  return src(['frontend/scss/style.scss', 'frontend/scss/design-system.scss'])
    .pipe(sass().on('error', sass.logError))
    .pipe(dest('frontend/css'));
}

function buildStyles() {
  return src(['frontend/scss/style.scss', 'frontend/scss/design-system.scss'])
    .pipe(sass({ style: 'compressed' }).on('error', sass.logError))
    .pipe(dest('frontend/css'));
}

export const dev = series(styles, function watchStyles() {
  return watch('frontend/scss/**/*.scss', styles);
});
export const build = buildStyles;

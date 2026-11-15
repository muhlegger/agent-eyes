
How to check a UI after a change: look at each screen logged in, at every width that matters. At phone
width, check for horizontal scrolling. Check whether content moves on its own after the page loads (late
banners, images without size). For animations and transitions, look at the motion frame by frame, not
only the end state: does the element shrink and come back, flicker (opacity drops and returns),
disappear, leave its path, or does the browser freeze (above ~50 ms is noticeable)? Check hover and
click states too.

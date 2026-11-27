// Handle private incident URLs before bootstrapping the signed-in application.
if (/^\/(?:[a-z][a-z0-9]{1,12}[0-9]|[A-Za-z0-9_-]{16})\/?$/.test(location.pathname)) {
  document.title = 'Landscape collection';
  const script = document.createElement('script');
  script.type = 'module';
  script.src = '/safety/activate.js';
  document.body.append(script);
} else if (/^\/p\/[A-Za-z0-9_-]{12}\/?$/.test(location.pathname)) {
  // Report-photo links render an ordinary photo page without the app around it.
  const script = document.createElement('script');
  script.type = 'module';
  script.src = '/safety/photo.js';
  document.body.append(script);
} else {
  void import('./main');
}

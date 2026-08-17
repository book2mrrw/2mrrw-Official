self.__MIDDLEWARE_MATCHERS = [
  {
    "regexp": "^(?:\\/(_next\\/data\\/[^/]{1,}))?(?:\\/((?!_next\\/static|_next\\/image|favicon.ico|api\\/public\\/.*|api\\/health.*|api\\/guest\\/.*|.*\\.(?:svg|png|jpg|jpeg|gif|webp|mp4|wav|mp3)$).*))(\\\\.json)?[\\/#\\?]?$",
    "originalSource": "/((?!_next/static|_next/image|favicon.ico|api/public/.*|api/health.*|api/guest/.*|.*\\.(?:svg|png|jpg|jpeg|gif|webp|mp4|wav|mp3)$).*)"
  }
];self.__MIDDLEWARE_MATCHERS_CB && self.__MIDDLEWARE_MATCHERS_CB()
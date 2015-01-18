require "jekyll-import";
  JekyllImport::Importers::Blogger.run({
    "source"			=> "/Users/dirk/Downloads/blog-01-04-2015.xml",
    "no-blogger-info"		=> false,
    "replace-internal-link" 	=> false
  })


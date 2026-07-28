{
  "targets": [{
    "target_name": "fuse",
    'variables': {
                    'fuse__include_dirs%': '<!(node scripts/fuse-config.js include-dirs)',
                    'fuse__library_dirs%': '',
                    'fuse__libraries%': '<!(node scripts/fuse-config.js libraries)'
                },
    "include_dirs": [
      "<!(node -e \"require('napi-macros')\")",
      "<@(fuse__include_dirs)"
    ],
    'library_dirs': [
                  '<@(fuse__library_dirs)',
    ],
    "link_settings": {
        "libraries": ["<@(fuse__libraries)"]},
    "libraries": [],
    "sources": [
      "fuse-native.c"
    ],
    'defines': [
      '_FILE_OFFSET_BITS=64'
    ],
    'xcode_settings': {
      'OTHER_CFLAGS': [
        '-g',
        '-O3',
        '-Wall'
      ]
    },
    'cflags': [
      '-g',
      '-O3',
      '-Wall'
    ],
  }, {
    "target_name": "postinstall",
    "type": "none",
    "dependencies": ["fuse"],
    "copies": [{
      "destination": "build/Release",
      "files": [  ],
    }]
  }]
}

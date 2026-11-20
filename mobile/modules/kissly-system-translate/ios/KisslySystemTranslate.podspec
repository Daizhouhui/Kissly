Pod::Spec.new do |s|
  s.name           = 'KisslySystemTranslate'
  s.version        = '0.1.0'
  s.summary        = 'On-device system translation for Kissly'
  s.description    = 'ML Kit on-device translation bridge.'
  s.author         = 'Kissly'
  s.homepage       = 'https://github.com/Daizhouhui/Kissly'
  s.license        = 'MIT'
  s.platforms      = { :ios => '16.4' }
  s.source         = { :path => '.' }
  s.source_files   = '**/*.{h,m,swift}'
  s.swift_version  = '5.9'
  s.dependency 'ExpoModulesCore'
  s.dependency 'GoogleMLKit/Translate', '8.0.0'
end

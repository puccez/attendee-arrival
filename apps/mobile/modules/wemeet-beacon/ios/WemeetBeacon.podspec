Pod::Spec.new do |s|
  s.name           = 'WemeetBeacon'
  s.version        = '0.1.0'
  s.summary        = 'Canale radio del check-in WeMeet: iBeacon monitoring e ranging.'
  s.description    = 'Region monitoring e ranging CoreLocation per il beacon-notaio.'
  s.author         = 'FirstLayer'
  s.homepage       = 'https://github.com/puccez/attendee-arrival'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end

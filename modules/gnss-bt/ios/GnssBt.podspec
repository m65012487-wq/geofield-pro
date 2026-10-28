Pod::Spec.new do |s|
  s.name           = 'GnssBt'
  s.version        = '1.0.0'
  s.summary        = 'GNSS receiver over Bluetooth LE'
  s.description    = 'NMEA stream from a GNSS receiver over Bluetooth LE'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks     = 'CoreBluetooth'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
  s.source_files   = '**/*.{h,m,swift}'
end

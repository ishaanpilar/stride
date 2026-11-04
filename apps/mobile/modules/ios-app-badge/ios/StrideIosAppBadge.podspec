Pod::Spec.new do |s|
  s.name = 'StrideIosAppBadge'
  s.version = '1.0.0'
  s.summary = 'Stride optional iOS app icon badge'
  s.description = 'Badge-only authorization and app icon count updates without scheduled notifications.'
  s.homepage = 'https://github.com/ishaanpilar/stride'
  s.license = { type: 'AGPL-3.0-only' }
  s.author = { 'Stride' => 'dongdongli@dongdongli.com' }
  s.platform = :ios, '15.1'
  s.swift_version = '5.0'
  s.source = { git: 'https://github.com/ishaanpilar/stride.git' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES', 'SWIFT_COMPILATION_MODE' => 'wholemodule' }
  s.source_files = '**/*.{h,m,swift}'
end

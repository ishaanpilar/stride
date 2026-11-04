Pod::Spec.new do |s|
  s.name = 'StrideAppleTaskSearch'
  s.version = '1.0.0'
  s.summary = 'Development-only on-device Spotlight task-search evaluation'
  s.description = 'Bridges SpotlightSearchTool result identifiers into the Stride development app.'
  s.homepage = 'https://github.com/ishaanpilar/stride'
  s.license = { type: 'AGPL-3.0-only' }
  s.author = { 'Stride' => 'dongdongli@dongdongli.com' }
  s.platform = :ios, '15.1'
  s.swift_version = '5.0'
  s.source = { git: 'https://github.com/ishaanpilar/stride.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'CoreSpotlight'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'OTHER_SWIFT_FLAGS' => '$(inherited) -Xfrontend -enable-cross-import-overlays',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = '*.swift'
end

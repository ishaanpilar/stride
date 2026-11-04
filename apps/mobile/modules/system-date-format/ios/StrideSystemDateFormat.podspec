Pod::Spec.new do |s|
  s.name = 'StrideSystemDateFormat'
  s.version = '1.0.0'
  s.summary = 'Stride system short-date preference bridge'
  s.description = 'Reads the current Gregorian short-date display pattern, including platform preferences.'
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

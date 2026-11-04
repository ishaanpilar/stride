Pod::Spec.new do |s|
  s.name = 'StrideIosWidget'
  s.version = '1.0.0'
  s.summary = 'Stride iOS widget action queue'
  s.description = 'Bridges the durable App Group widget completion queue into Stride.'
  s.homepage = 'https://github.com/ishaanpilar/stride'
  s.license = { type: 'AGPL-3.0-only' }
  s.author = { 'Stride' => 'dongdongli@dongdongli.com' }
  s.platform = :ios, '15.1'
  s.swift_version = '5.0'
  s.source = { git: 'https://github.com/ishaanpilar/stride.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'WidgetKit'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = 'StrideIosWidgetModule.swift', 'StrideWidgetActionStore.swift'
end

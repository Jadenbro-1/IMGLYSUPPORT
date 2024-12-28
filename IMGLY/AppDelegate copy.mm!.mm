//
//  AppDelegate.m
//

#import "AppDelegate.h"
#import <React/RCTBundleURLProvider.h>

// 1) Import your auto-generated Swift bridging header.
//    If your Xcode target is "FreshTempNew", it typically is "FreshTempNew-Swift.h".
#import "FreshTempNew-Swift.h"
#import <Firebase.h>

@implementation AppDelegate

- (BOOL)application:(UIApplication *)application didFinishLaunchingWithOptions:(NSDictionary *)launchOptions
{
  // 2) Call your Swift bridging logic here.
  //    If you defined a Swift class named `IMGLYCustomization` in `IMGLYCustomization.swift`,
  //    you can now reference its methods:
  [IMGLYCustomization apply];
  [FIRApp configure];

  // 3) Existing RN setup: set moduleName, initialProps, etc.
  self.moduleName = @"FreshTempNew";
  self.initialProps = @{};

  // 4) Return as normal
  return [super application:application didFinishLaunchingWithOptions:launchOptions];
}

// Called by React Native to determine the JS bundle URL
- (NSURL *)sourceURLForBridge:(RCTBridge *)bridge
{
  return [self bundleURL];
}

- (NSURL *)bundleURL
{
#if DEBUG
  return [[RCTBundleURLProvider sharedSettings] jsBundleURLForBundleRoot:@"index"];
#else
  return [[NSBundle mainBundle] URLForResource:@"main" withExtension:@"jsbundle"];
#endif
}

@end
